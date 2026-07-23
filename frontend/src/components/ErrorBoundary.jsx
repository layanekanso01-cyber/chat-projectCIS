import { Component } from "react";

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Unhandled render error:", error, info);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center text-foreground">
        <h1 className="text-lg font-medium">Something went wrong</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The app hit an unexpected error and couldn't recover on its own. Reloading
          usually fixes it.
        </p>
        <button
          type="button"
          onClick={this.handleReload}
          className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/80"
        >
          Reload
        </button>
      </div>
    );
  }
}
