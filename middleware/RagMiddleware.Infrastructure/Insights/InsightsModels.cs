namespace RagMiddleware.Infrastructure.Insights;

public record FeedbackBreakdown(int Up, int Down, int NoFeedback);

public record ReasonCount(string Reason, int Count);

public record RetrievalGapItem(
    string ConversationId,
    string MessageId,
    string? Question,
    string AnswerSnippet,
    DateTime? Timestamp);

public record QuestionCount(string Question, int Count);

public record DailyUsage(string Date, int Count);

public record ProviderCount(string Provider, int Count);

public record InsightsSummary(
    FeedbackBreakdown Feedback,
    IReadOnlyList<ReasonCount> TopDownvoteReasons,
    IReadOnlyList<RetrievalGapItem> RetrievalGaps,
    IReadOnlyList<QuestionCount> MostAskedQuestions,
    IReadOnlyList<DailyUsage> UsageByDay,
    IReadOnlyList<ProviderCount> ProviderSplit);
