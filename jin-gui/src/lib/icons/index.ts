/**
 * icons/index.ts — Lucide icon render helper (ISC license).
 *
 * Uses Lucide's data-lucide approach: markup declares `<i data-lucide="name">`
 * and `initIcons()` replaces those elements with actual SVGs on connect.
 * Only the icons used in the app are imported (tree-shaking).
 *
 * Icon weight (stroke-width) is set globally via CSS custom property
 * --icon-stroke-width. Components can override per icon. This approximates
 * SF Symbols' weight-matching (which is unavailable outside Apple platforms).
 *
 * Usage in HTML:
 *   <i data-lucide="calendar" aria-hidden="true"></i>
 *
 * Always pair with a text label or aria-label for color-independence
 * and screen reader parity (HIG accessibility baseline).
 */

import {
  createIcons,
  // Sidebar navigation
  Calendar,
  FileText,
  CheckSquare,
  CalendarDays,
  Settings,
  Plus,
  // Error states
  AlertCircle,
  AlertTriangle,
  WifiOff,
  // Actions
  X,
  RefreshCw,
  Upload,
  LogIn,
  LogOut,
  Link,
  GitBranch,      // Typed-link action button in note detail
  // Content
  Tag,
  Clock,
  MapPin,
  UserRound,
  UsersRound,
  Video,
  ChevronRight,
  ChevronLeft,
  // Today / Agenda view (GUI-S3)
  Database,       // Jin source badge
  Cloud,          // Google source badge
  Circle,         // Fallback source badge / todo task status
  Repeat,         // Recurring event flag
  CalendarOff,    // Empty state
  // Browse + detail views (GUI-S4)
  ArrowLeft,      // Back button in detail panels
  ArrowUp,        // High priority indicator
  ArrowDown,      // Low priority indicator
  Minus,          // Normal priority indicator
  CheckCircle,    // Done task status
  XCircle,        // Cancelled task status
  CircleDot,      // Doing (in progress) task status
  Archive,        // Archived note status
  File,           // Default / unknown note status
  // Note editor formatting toolbar (Apple-Notes-style)
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  // Cozy writing mode toggles (COZY-1 focus mode / COZY-2 typewriter scrolling)
  Focus,
  AlignCenterVertical,
  // Code-block chrome (reading-view copy + wrap-text buttons)
  Copy,
  WrapText,
  // Folder tree (Wave 2B)
  Folder,         // Folder icon in tree rows
  FolderPlus,     // New Folder button / New Subfolder
  PanelLeftClose, // Collapse sidebar control
  PanelLeftOpen,  // Reveal sidebar control
  // Folder management (folder-mgmt)
  EllipsisVertical, // Per-row kebab menu button
  Pencil,           // Rename folder menuitem icon
  Trash2,           // Delete folder menuitem icon
  // Note compose (NN-2)
  SquarePen,      // New Note compose button
  // Registry sync — referenced in live markup but previously unregistered (icons
  // silently failed to render). Found via a used-vs-registered audit.
  Sun,            // Settings: light theme
  Moon,           // Settings: dark theme
  Monitor,        // Settings: system theme
  BookOpen,       // Settings
  Download,       // Settings / sync
  Loader,         // Settings / sync (loading state)
  Link2Off,       // Settings / sync (disconnected state)
  CalendarPlus,   // Tasks: promote-to-event button
  Paperclip,      // Events: attach button
  // Tasks P0 — Priority flag glyph (tinted via CSS data-priority)
  Flag,           // Priority indicator (high/medium/low); none = no flag
  // Lists P3 / Tags P4
  Inbox,          // Default list (inbox) icon in the lists sidebar rail
  Palette,        // Recolor action icon in list edit dialog
  // Views P6 — List/Board toggle + collapsible section header
  LayoutGrid,     // Board-view toggle icon
  ListFilter,     // Responsive task-filter disclosure
  ChevronDown,    // Collapsible section header indicator
  // P9: drag-and-drop manual reorder
  GripVertical,   // Drag handle on task rows / cards
  // P10: reminder chips + editor
  Bell,           // Reminder chip icon
  BellPlus,       // Add reminder button
  // S4: board Kanban-by-status
  RotateCcw,      // Reopen action on a `done` board card (done -> todo)
} from 'lucide';

export {
  Calendar,
  FileText,
  CheckSquare,
  CalendarDays,
  Settings,
  Plus,
  AlertCircle,
  AlertTriangle,
  WifiOff,
  X,
  RefreshCw,
  Upload,
  LogIn,
  LogOut,
  Link,
  GitBranch,
  Tag,
  Clock,
  MapPin,
  UserRound,
  UsersRound,
  Video,
  ChevronRight,
  ChevronLeft,
  // Today / Agenda view
  Database,
  Cloud,
  Circle,
  Repeat,
  CalendarOff,
  // Browse + detail views (GUI-S4)
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Minus,
  CheckCircle,
  XCircle,
  CircleDot,
  Archive,
  File,
  // Note editor formatting toolbar
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  // Cozy writing mode toggles (COZY-1 / COZY-2)
  Focus,
  AlignCenterVertical,
  // Code-block chrome (reading-view copy + wrap-text buttons)
  Copy,
  WrapText,
  // Folder tree (Wave 2B)
  Folder,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen,
  // Folder management (folder-mgmt)
  EllipsisVertical,
  Pencil,
  Trash2,
  // Note compose (NN-2)
  SquarePen,
  // Registry sync (previously unregistered)
  Sun,
  Moon,
  Monitor,
  BookOpen,
  Download,
  Loader,
  Link2Off,
  CalendarPlus,
  Paperclip,
  // Tasks P0 — Priority flag
  Flag,
  // Lists P3 / Tags P4
  Inbox,
  Palette,
  // Views P6 — List/Board toggle + collapsible section header
  LayoutGrid,
  ListFilter,
  ChevronDown,
  // P9: drag-and-drop manual reorder
  GripVertical,
  // P10: reminder chips + editor
  Bell,
  BellPlus,
  // S4: board Kanban-by-status
  RotateCcw,
};

const REGISTERED_ICONS = {
  Calendar,
  FileText,
  CheckSquare,
  CalendarDays,
  Settings,
  Plus,
  AlertCircle,
  AlertTriangle,
  WifiOff,
  X,
  RefreshCw,
  Upload,
  LogIn,
  LogOut,
  Link,
  GitBranch,
  Tag,
  Clock,
  MapPin,
  UserRound,
  UsersRound,
  Video,
  ChevronRight,
  ChevronLeft,
  // Today / Agenda view
  Database,
  Cloud,
  Circle,
  Repeat,
  CalendarOff,
  // Browse + detail views (GUI-S4)
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Minus,
  CheckCircle,
  XCircle,
  CircleDot,
  Archive,
  File,
  // Note editor formatting toolbar
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  // Cozy writing mode toggles (COZY-1 / COZY-2)
  Focus,
  AlignCenterVertical,
  // Code-block chrome (reading-view copy + wrap-text buttons)
  Copy,
  WrapText,
  // Folder tree (Wave 2B)
  Folder,
  FolderPlus,
  PanelLeftClose,
  PanelLeftOpen,
  // Folder management (folder-mgmt)
  EllipsisVertical,
  Pencil,
  Trash2,
  // Note compose (NN-2)
  SquarePen,
  // Registry sync (previously unregistered)
  Sun,
  Moon,
  Monitor,
  BookOpen,
  Download,
  Loader,
  Link2Off,
  CalendarPlus,
  Paperclip,
  // Tasks P0 — Priority flag
  Flag,
  // Lists P3 / Tags P4
  Inbox,
  Palette,
  // Views P6 — List/Board toggle + collapsible section header
  LayoutGrid,
  ListFilter,
  ChevronDown,
  // P9: drag-and-drop manual reorder
  GripVertical,
  // P10: reminder chips + editor
  Bell,
  BellPlus,
  // S4: board Kanban-by-status
  RotateCcw,
};

const ICON_ATTRS = {
  // Inherit size from context via CSS (set width/height in .jin-nav-item svg)
  // stroke-width controlled by CSS custom property below
  'stroke-width': '1.75',
  'aria-hidden': 'true',
};

/**
 * initIcons — hydrate Lucide placeholders globally, or only within a newly
 * mounted subtree. Scoped hydration never replaces existing SVG nodes.
 */
export function initIcons(root: ParentNode = document): void {
  if (root === document) {
    createIcons({ icons: REGISTERED_ICONS, attrs: ICON_ATTRS });
    return;
  }

  const scopeAttr = 'data-jin-lucide-scope';
  const placeholders = root.querySelectorAll<HTMLElement>('i[data-lucide]');
  if (placeholders.length === 0) return;
  placeholders.forEach(icon => {
    const name = icon.getAttribute('data-lucide');
    if (name) icon.setAttribute(scopeAttr, name);
  });
  createIcons({ icons: REGISTERED_ICONS, nameAttr: scopeAttr, attrs: ICON_ATTRS });
  root.querySelectorAll(`[${scopeAttr}]`).forEach(icon => icon.removeAttribute(scopeAttr));
}
