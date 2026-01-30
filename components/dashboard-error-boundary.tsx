"use client";

import React from "react";
import Link from "next/link";

interface DashboardErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error boundary for the Command Center dashboard.
 * Catches runtime errors in any tab (Map, Fleet, Campaigns, Deal Desk, Settings)
 * so one failing tab does not white-screen the entire system.
 */
export class DashboardErrorBoundary extends React.Component<
  DashboardErrorBoundaryProps,
  State
> {
  constructor(props: DashboardErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[DashboardErrorBoundary] Caught error:", {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 p-6 text-foreground">
          <div className="w-full max-w-md rounded-xl border border-red-500/30 bg-zinc-900/80 p-6">
            <h1 className="mb-2 text-lg font-bold text-red-400">
              Something went wrong
            </h1>
            <p className="mb-4 text-sm text-muted-foreground">
              The Command Center hit an error. Try refreshing the page. If it
              persists, check the browser console.
            </p>
            <p className="mb-4 font-mono text-xs text-muted-foreground break-all">
              {this.state.error.message}
            </p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, error: null })}
              className="rounded border border-white/20 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
            >
              Try again
            </button>
            <span className="mx-2 text-muted-foreground">or</span>
            <Link
              href="/"
              className="rounded border border-white/20 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
            >
              Go to dashboard
            </Link>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
