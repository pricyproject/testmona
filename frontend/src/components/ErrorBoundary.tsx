import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  description: string;
  isRTL: boolean;
  reloadLabel: string;
  resetKey: string;
  retryLabel: string;
  title: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Unhandled render error', error, errorInfo);
  }

  componentDidUpdate(previousProps: ErrorBoundaryProps): void {
    if (this.state.hasError && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div
        className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-6"
        dir={this.props.isRTL ? 'rtl' : 'ltr'}
        role="alert"
      >
        <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-lg dark:border-gray-800 dark:bg-gray-900">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            {this.props.title}
          </h1>
          <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-300">
            {this.props.description}
          </p>
          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <button
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
              onClick={() => this.setState({ hasError: false })}
              type="button"
            >
              {this.props.retryLabel}
            </button>
            <button
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 transition hover:bg-gray-50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
              onClick={() => window.location.reload()}
              type="button"
            >
              {this.props.reloadLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
