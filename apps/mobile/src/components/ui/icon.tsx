import {
  Archive,
  ArrowLeft,
  ArrowRight,
  ArrowRightToLine,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Copy,
  ExternalLink,
  File,
  FileDiff,
  Folder,
  GitBranch,
  GitPullRequest,
  Globe,
  Hand,
  Image,
  Laptop,
  LoaderCircle,
  LogOut,
  Menu,
  Mic,
  PanelRightClose,
  PanelRightOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquarePen,
  Terminal,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react-native";
import type { ComponentProps, ComponentType } from "react";

export type AppIconName =
  | "archive"
  | "attach"
  | "branch"
  | "closeMenu"
  | "chevronRight"
  | "check"
  | "controls"
  | "copy"
  | "expand"
  | "externalLink"
  | "fast"
  | "file"
  | "fileDiff"
  | "folder"
  | "goal"
  | "web"
  | "menu"
  | "model"
  | "newChat"
  | "newThread"
  | "permissions"
  | "permissionsAuto"
  | "permissionsDefault"
  | "permissionsFull"
  | "preview"
  | "previewHide"
  | "pullRequest"
  | "refresh"
  | "running"
  | "search"
  | "send"
  | "sendToLine"
  | "sidebarHide"
  | "sidebarShow"
  | "back"
  | "forward"
  | "settings"
  | "signOut"
  | "stop"
  | "terminal"
  | "trash"
  | "up"
  | "upload"
  | "voice"
  | "warning"
  | "workspace"
  | "x";

type LucideComponent = ComponentType<ComponentProps<typeof Search>>;

const iconComponents: Record<AppIconName, LucideComponent> = {
  archive: Archive,
  attach: Image,
  branch: GitBranch,
  check: Check,
  closeMenu: Menu,
  chevronRight: ChevronRight,
  controls: SlidersHorizontal,
  copy: Copy,
  expand: ChevronDown,
  externalLink: ExternalLink,
  fast: Zap,
  file: File,
  fileDiff: FileDiff,
  folder: Folder,
  goal: CircleCheck,
  web: Globe,
  menu: Menu,
  model: Sparkles,
  newChat: SquarePen,
  newThread: Plus,
  permissions: Shield,
  permissionsAuto: Zap,
  permissionsDefault: Hand,
  permissionsFull: ShieldCheck,
  preview: PanelRightOpen,
  previewHide: PanelRightClose,
  pullRequest: GitPullRequest,
  refresh: RefreshCw,
  running: LoaderCircle,
  search: Search,
  send: ArrowUp,
  sendToLine: ArrowRightToLine,
  sidebarHide: PanelLeftClose,
  sidebarShow: PanelLeftOpen,
  back: ArrowLeft,
  forward: ArrowRight,
  settings: Settings,
  signOut: LogOut,
  stop: Square,
  terminal: Terminal,
  trash: Trash2,
  up: ArrowUp,
  upload: Upload,
  voice: Mic,
  warning: CircleAlert,
  workspace: Laptop,
  x: X,
};

type IconProps = Omit<ComponentProps<typeof Search>, "color"> & {
  name: AppIconName;
  tintColor?: string;
};

function Icon({ name, size = 16, tintColor, strokeWidth = 2, ...props }: IconProps) {
  const Component = iconComponents[name];
  return <Component color={tintColor} size={size} strokeWidth={strokeWidth} {...props} />;
}

export { Icon };
