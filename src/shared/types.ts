export type Message = {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  time: number;
};
export type Conversation = {
  id: string;
  title: string;
  messages: Message[];
  summary: string;
  summarizedThrough: number;
  updated: number;
};
export type Settings = {
  baseUrl: string;
  model: string;
  contextLimit: number;
  outputLimit: number;
  maxSteps: number;
  browserProxy: string;
  modelProxy: string;
  keySet: boolean;
  apiKey?: string;
  clearKey?: boolean;
};
export type Tab = {
  id: string;
  title: string;
  url: string;
  loading: boolean;
  zoom: number;
  error?: string;
};
export type Schedule = {
  id: string;
  title: string;
  time: string;
  url: string;
  prompt: string;
  enabled: boolean;
  lastRun: string;
  status: string;
};
export type State = {
  tabs: Tab[];
  activeTab: string;
  conversations: Conversation[];
  activeConversation: string;
  settings: Settings;
  schedules: Schedule[];
  running: boolean;
  targetTab: string;
  runningConversation: string;
  phase: string;
  draft: string;
  sidebar: number;
  dataPath: string;
};
export type WireMessage = {
  role: string;
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
};
declare global {
  interface Window {
    host: {
      invoke: (command: string, payload?: any) => Promise<any>;
      onState: (cb: (state: State) => void) => () => void;
      onFocusAddress: (cb: () => void) => () => void;
    };
  }
}
