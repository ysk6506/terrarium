/**
 * What a person sees when a screen's code cannot be fetched (the network went away, the server restarted): a sentence
 * that says what happened and the ways on, instead of a blank page. Screens are loaded on demand (ADR-0141), so this
 * can happen to any of them. A rejected `lazy` import stays rejected, so "다시 불러오기" reloads the page.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Failure } from "./kit";

interface Props {
  /** The boundary starts over when this changes (another screen). */
  readonly resetKey: string;
  readonly children: ReactNode;
}

export class ScreenBoundary extends Component<Props, { readonly error: Error | undefined }> {
  override state: { readonly error: Error | undefined } = { error: undefined };

  static getDerivedStateFromError(error: Error): { readonly error: Error } {
    return { error };
  }

  override componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error)
      this.setState({ error: undefined });
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // the message is on screen; nothing else to do
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <Failure
          error={new Error("화면을 불러오지 못했어요. 서버나 네트워크에 닿는지 확인해 주세요.")}
          retry={() => window.location.reload()}
        />
      </div>
    );
  }
}
