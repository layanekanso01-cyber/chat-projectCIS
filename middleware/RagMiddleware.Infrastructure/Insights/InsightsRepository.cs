using System.Text.RegularExpressions;
using MongoDB.Bson;
using MongoDB.Driver;
using RagMiddleware.Domain;
using RagMiddleware.Infrastructure.Mongo;

namespace RagMiddleware.Infrastructure.Insights;

/// <summary>
/// Reads directly from the Python RAG API's own "conversations" collection (read-only —
/// this app never writes there) plus this app's own audit log, to build an admin-facing
/// picture of how the chatbot is actually being used: what people ask, what they rate
/// badly, and where the model says it doesn't know.
///
/// Aggregation happens in memory rather than as a Mongo pipeline: the conversations
/// collection has a schema this app doesn't own (Python's, not ours), and at the data
/// volume an admin dashboard like this deals with, pulling the collection once and
/// computing five straightforward summaries in C# is far more maintainable than five
/// hand-written pipelines against a foreign, evolving document shape.
/// </summary>
public class InsightsRepository : IInsightsRepository
{
    // Heuristic for "the model didn't actually know the answer" — phrasing patterns
    // observed from real "I don't have that information" style responses. Necessarily
    // imperfect (it's matching prose, not a structured signal), but a useful proxy for
    // real retrieval gaps until/unless the pipeline emits an explicit "no match" flag.
    private static readonly Regex NoInformationPattern = new(
        @"don'?t have (enough )?information|do not have (enough )?information|" +
        @"couldn'?t find|could not find|no information (about|on)|" +
        @"not (mentioned|found) in the (provided )?context|" +
        @"i'?m not sure|i am not sure",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private const int TopReasonsLimit = 5;
    private const int RetrievalGapsLimit = 20;
    private const int MostAskedQuestionsLimit = 10;
    private const int UsageDaysWindow = 14;

    private readonly IMongoCollection<BsonDocument> _conversations;
    private readonly IMongoCollection<AuditLog> _auditLogs;

    public InsightsRepository(MongoDbContext context)
    {
        _conversations = context.RagAppDatabase.GetCollection<BsonDocument>("conversations");
        _auditLogs = context.Database.GetCollection<AuditLog>("audit_logs");
    }

    public async Task<InsightsSummary> GetSummaryAsync(CancellationToken cancellationToken)
    {
        var conversations = await _conversations.Find(FilterDefinition<BsonDocument>.Empty)
            .ToListAsync(cancellationToken);

        var assistantMessages = new List<BsonDocument>();
        var userQuestions = new List<string>();
        // (conversationId, question-preceding-it, assistant message doc)
        var gapsCandidates = new List<(string ConversationId, string? Question, BsonDocument Message)>();

        foreach (var conversation in conversations)
        {
            if (!conversation.TryGetValue("messages", out var messagesValue) || !messagesValue.IsBsonArray)
            {
                continue;
            }

            var conversationId = conversation.GetValue("_id", "").AsString ?? "";
            string? lastQuestion = null;

            foreach (var messageValue in messagesValue.AsBsonArray)
            {
                var message = messageValue.AsBsonDocument;
                var role = message.GetValue("role", "").AsString;

                if (role == "user")
                {
                    lastQuestion = message.GetValue("content", "").AsString;
                    if (!string.IsNullOrWhiteSpace(lastQuestion))
                    {
                        userQuestions.Add(lastQuestion.Trim());
                    }
                }
                else if (role == "assistant")
                {
                    assistantMessages.Add(message);

                    var content = message.GetValue("content", "").AsString ?? "";
                    if (NoInformationPattern.IsMatch(content))
                    {
                        gapsCandidates.Add((conversationId, lastQuestion, message));
                    }
                }
            }
        }

        return new InsightsSummary(
            Feedback: BuildFeedbackBreakdown(assistantMessages),
            TopDownvoteReasons: BuildTopDownvoteReasons(assistantMessages),
            RetrievalGaps: BuildRetrievalGaps(gapsCandidates),
            MostAskedQuestions: BuildMostAskedQuestions(userQuestions),
            UsageByDay: await BuildUsageByDayAsync(cancellationToken),
            ProviderSplit: BuildProviderSplit(assistantMessages));
    }

    private static FeedbackBreakdown BuildFeedbackBreakdown(List<BsonDocument> assistantMessages)
    {
        int up = 0, down = 0, none = 0;
        foreach (var message in assistantMessages)
        {
            var feedback = message.GetValue("feedback", BsonNull.Value);
            if (feedback.IsString && feedback.AsString == "up") up++;
            else if (feedback.IsString && feedback.AsString == "down") down++;
            else none++;
        }
        return new FeedbackBreakdown(up, down, none);
    }

    private static IReadOnlyList<ReasonCount> BuildTopDownvoteReasons(List<BsonDocument> assistantMessages)
    {
        return assistantMessages
            .Where(m => m.GetValue("feedback", BsonNull.Value) is { IsString: true } f && f.AsString == "down")
            .Select(m => m.GetValue("feedback_reason", BsonNull.Value))
            .Where(r => r.IsString && !string.IsNullOrWhiteSpace(r.AsString))
            .GroupBy(r => r.AsString)
            .Select(g => new ReasonCount(g.Key, g.Count()))
            .OrderByDescending(r => r.Count)
            .Take(TopReasonsLimit)
            .ToList();
    }

    private static IReadOnlyList<RetrievalGapItem> BuildRetrievalGaps(
        List<(string ConversationId, string? Question, BsonDocument Message)> candidates)
    {
        return candidates
            .Select(c =>
            {
                var content = c.Message.GetValue("content", "").AsString ?? "";
                DateTime? timestamp = ParseTimestamp(c.Message.GetValue("timestamp", BsonNull.Value));
                return new RetrievalGapItem(
                    ConversationId: c.ConversationId,
                    MessageId: c.Message.GetValue("id", "").AsString ?? "",
                    Question: c.Question,
                    AnswerSnippet: content.Length > 200 ? content[..200].TrimEnd() + "…" : content,
                    Timestamp: timestamp);
            })
            .OrderByDescending(g => g.Timestamp)
            .Take(RetrievalGapsLimit)
            .ToList();
    }

    // The Python side stores timestamps as an ISO-8601 string
    // (datetime.now(timezone.utc).isoformat()), not a native BSON date — this handles
    // that shape, with a BsonDateTime fallback in case that ever changes upstream.
    private static DateTime? ParseTimestamp(BsonValue value)
    {
        if (value.IsValidDateTime)
        {
            return value.ToUniversalTime();
        }
        if (value.IsString && DateTime.TryParse(
                value.AsString,
                System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal,
                out var parsed))
        {
            return parsed;
        }
        return null;
    }

    private static IReadOnlyList<QuestionCount> BuildMostAskedQuestions(List<string> userQuestions)
    {
        return userQuestions
            .GroupBy(q => q.Trim().ToLowerInvariant())
            .Select(g => new QuestionCount(g.First().Trim(), g.Count()))
            .OrderByDescending(q => q.Count)
            .Take(MostAskedQuestionsLimit)
            .ToList();
    }

    private static IReadOnlyList<ProviderCount> BuildProviderSplit(List<BsonDocument> assistantMessages)
    {
        return assistantMessages
            .Select(m => m.GetValue("provider", BsonNull.Value))
            .Where(p => p.IsString && !string.IsNullOrWhiteSpace(p.AsString))
            .GroupBy(p => p.AsString)
            .Select(g => new ProviderCount(g.Key, g.Count()))
            .OrderByDescending(p => p.Count)
            .ToList();
    }

    private async Task<IReadOnlyList<DailyUsage>> BuildUsageByDayAsync(CancellationToken cancellationToken)
    {
        var since = DateTime.UtcNow.Date.AddDays(-(UsageDaysWindow - 1));
        var logs = await _auditLogs
            .Find(l => l.Timestamp >= since)
            .Project(l => l.Timestamp)
            .ToListAsync(cancellationToken);

        var byDay = logs
            .GroupBy(t => t.Date)
            .ToDictionary(g => g.Key, g => g.Count());

        var result = new List<DailyUsage>();
        for (var day = since; day <= DateTime.UtcNow.Date; day = day.AddDays(1))
        {
            result.Add(new DailyUsage(day.ToString("yyyy-MM-dd"), byDay.GetValueOrDefault(day, 0)));
        }
        return result;
    }
}
