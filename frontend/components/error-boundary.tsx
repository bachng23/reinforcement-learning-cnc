"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
};

type State = {
  hasError: boolean;
  message: string;
};

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: unknown): State {
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred.";
    return { hasError: true, message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, message: "" });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div
          role="alert"
          style={{
            padding: "24px",
            borderRadius: "8px",
            background: "var(--color-rose-tint, #fff1f2)",
            color: "var(--color-rose, #e11d48)",
            border: "1px solid #fecdd3",
            display: "flex",
            flexDirection: "column",
            gap: "12px",
          }}
        >
          <strong style={{ fontSize: "14px" }}>Something went wrong</strong>
          <p style={{ fontSize: "13px", opacity: 0.8 }}>{this.state.message}</p>
          <button
            onClick={this.handleReset}
            style={{
              alignSelf: "flex-start",
              padding: "6px 14px",
              borderRadius: "6px",
              border: "1px solid #fecdd3",
              background: "white",
              color: "var(--color-rose, #e11d48)",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
