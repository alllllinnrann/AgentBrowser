import type { ButtonHTMLAttributes } from "react";
const paths = {
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M18 6 6 18",
  back: "m12 5-7 7 7 7M5 12h14",
  forward: "m12 5 7 7-7 7M5 12h14",
  reload: "M20 7v5h-5M19 12a7 7 0 1 0-2 5M20 12l-2-5",
  globe:
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18Z",
  lock: "M7 10V7a5 5 0 0 1 10 0v3M6 10h12v11H6ZM12 14v3",
  search: "M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  panel: "M3 4h18v16H3ZM15 4v16",
  agent: "m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z",
  history: "M3 4v5h5M3 9a9 9 0 1 1 0 7M12 7v5l3 2",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2",
  settings:
    "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1ZM16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  external: "M14 3h7v7M21 3l-9 9M10 5H4v15h15v-6",
  send: "M12 19V5m-6 6 6-6 6 6",
  stop: "M6 6h12v12H6Z",
  hand: "M8 12V5a2 2 0 0 1 4 0v7-9a2 2 0 0 1 4 0v9-6a2 2 0 0 1 4 0v9c0 4-3 7-7 7h-1c-3 0-5-2-7-5l-3-5a2 2 0 0 1 3-2l3 3",
  message: "M21 4H3v14h5l4 3 4-3h5Z",
  document: "M6 3h8l4 4v14H6ZM14 3v5h4M9 12h6M9 16h6",
  check: "m5 12 4 4L19 6",
  chevron: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  memory:
    "M7 3v3m5-3v3m5-3v3M7 18v3m5-3v3m5-3v3M3 7h3m-3 5h3m-3 5h3m12-10h3m-3 5h3m-3 5h3M6 6h12v12H6Z",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  folder: "M3 6h7l2 2h9v12H3Z",
  edit: "m15 4 5 5M4 20l1-6L16 3l5 5-11 11ZM4 20l6-1",
  play: "m8 4 12 8-12 8Z",
  pause: "M7 4v16M17 4v16",
  info: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 11v6m0-10v1",
  user: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-3a8 8 0 0 1 16 0v3",
  alert: "m12 3 10 18H2ZM12 9v5m0 3v1",
  link: "m10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0",
};
export type IconName = keyof typeof paths;
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function IconButton({
  icon,
  label,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={"icon-button " + className}
      {...props}
    >
      <Icon name={icon} />
    </button>
  );
}
