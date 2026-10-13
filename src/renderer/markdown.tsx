import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownMessage({
  children,
  openLink,
}: {
  children: string;
  openLink: (url: string) => void;
}) {
  return (
    <div className="markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) =>
            /^https?:\/\//i.test(href || "") ? (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault();
                  openLink(href!);
                }}
              >
                {children}
              </a>
            ) : (
              <span>{children}</span>
            ),
          // Remote images must not make background requests from model output.
          img: ({ alt }) => <span>{alt || "图片"}</span>,
          table: ({ children }) => (
            <div className="markdown-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
