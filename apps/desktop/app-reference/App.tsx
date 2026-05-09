import { useState } from "react";
// import svgPaths from "../imports/TeamCollaborationApp/svg-rqn7zqg0pg";

function BackIcon({ isDark }: { isDark?: boolean }) {
  return (
    <svg className="size-5" fill="none" viewBox="0 0 20 20">
      <path
        d="M15.8333 10H4.16667M4.16667 10L10 15.8333M4.16667 10L10 4.16667"
        stroke={isDark ? "#ffffff" : "#0A0A0A"}
        strokeWidth="1.66667"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg className="size-5" fill="none" viewBox="0 0 20 20">
      <circle
        cx="10"
        cy="10"
        r="3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M10 2V3M10 17V18M18 10H17M3 10H2M15.66 4.34L14.95 5.05M5.05 14.95L4.34 15.66M15.66 15.66L14.95 14.95M5.05 5.05L4.34 4.34"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg className="size-5" fill="none" viewBox="0 0 20 20">
      <path
        d="M18 11.25C17.5 15.5 13.5 18.5 9.25 18C5 17.5 2 13.5 2.5 9.25C3 5 7 2 11.25 2.5C10 3.5 9.25 5.25 9.25 7.25C9.25 10.5 11.75 13 15 13C16.5 13 17.75 12.5 18.75 11.5C18.5 11.5 18.25 11.25 18 11.25Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TopBar({
  isDark,
  toggleTheme,
}: {
  isDark: boolean;
  toggleTheme: () => void;
}) {
  return (
    <div
      className={`h-[64px] border-b flex items-center justify-between px-6 ${
        isDark
          ? "bg-[oklch(0.145_0_0)] border-[rgba(255,255,255,0.1)]"
          : "bg-white border-[rgba(0,0,0,0.1)]"
      }`}
    >
      <div className="flex items-center gap-6">
        <button
          className={`p-2 rounded-lg ${isDark ? "hover:bg-[oklch(0.269_0_0)]" : "hover:bg-[#ececf0]"}`}
        >
          <BackIcon isDark={isDark} />
        </button>
        <h1
          className={`font-['Inter:Medium',sans-serif] font-medium ${isDark ? "text-white" : "text-[#0a0a0a]"}`}
        >
          TeamCollab
        </h1>
        <span
          className={`font-['Inter:Regular',sans-serif] ${isDark ? "text-[#717182]" : "text-[#717182]"}`}
        >
          Project Workspace
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="size-2 rounded-sm bg-green-500"></div>
          <span
            className={`font-['Inter:Regular',sans-serif] ${isDark ? "text-white" : "text-[#0a0a0a]"}`}
          >
            health: online
          </span>
        </div>
        <div
          className={`h-4 w-px ${isDark ? "bg-[rgba(255,255,255,0.1)]" : "bg-[rgba(0,0,0,0.1)]"}`}
        ></div>
        <button
          onClick={toggleTheme}
          className={`p-2 rounded-md ${isDark ? "text-[#717182] hover:bg-[oklch(0.269_0_0)]" : "text-[#717182] hover:bg-[#ececf0]"}`}
        >
          {isDark ? <MoonIcon /> : <SunIcon />}
        </button>
      </div>
    </div>
  );
}

function TeamMemberItem({
  name,
  status,
  isDark,
}: {
  name: string;
  status: string;
  isDark: boolean;
}) {
  return (
    <div
      className={`px-4 py-3 cursor-pointer rounded-lg ${isDark ? "hover:bg-[oklch(0.269_0_0)]" : "hover:bg-[#ececf0]"}`}
    >
      <p
        className={`font-['Inter:Regular',sans-serif] ${isDark ? "text-white" : "text-[#0a0a0a]"}`}
      >
        {name}
      </p>
      <p
        className={`font-['Inter:Regular',sans-serif] text-[12px] ${isDark ? "text-[#717182]" : "text-[#717182]"}`}
      >
        {status}
      </p>
    </div>
  );
}

function Sidebar({ isDark }: { isDark: boolean }) {
  const teamMembers = [
    { name: "Sarah Chen", status: "Online" },
    { name: "Mike Johnson", status: "In a meeting" },
    { name: "Emma Davis", status: "Online" },
    { name: "James Wilson", status: "Away" },
    { name: "Lisa Anderson", status: "Online" },
  ];

  return (
    <div
      className={`w-[256px] border-r flex flex-col ${
        isDark
          ? "bg-[oklch(0.145_0_0)] border-[rgba(255,255,255,0.1)]"
          : "bg-white border-[rgba(0,0,0,0.1)]"
      }`}
    >
      {/* <div
        className={`px-3 py-2 border-b ${isDark ? "border-[rgba(255,255,255,0.1)]" : "border-[rgba(0,0,0,0.1)]"}`}
      >
        <h2
          className={`font-['Inter:Medium',sans-serif] font-medium text-[15px] ${isDark ? "text-white" : "text-[#0a0a0a]"}`}
        >
          Team Roster
        </h2>
        <p
          className={`font-['Inter:Regular',sans-serif] text-[12px] ${isDark ? "text-[#717182]" : "text-[#717182]"}`}
        >
          {teamMembers.length} members
        </p>
      </div> */}
      <div className="flex-1 overflow-y-auto p-2">
        {teamMembers.map((member, idx) => (
          <TeamMemberItem
            key={idx}
            name={member.name}
            status={member.status}
            isDark={isDark}
          />
        ))}
      </div>
    </div>
  );
}

function TabButton({
  active,
  children,
  onClick,
  isDark,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  isDark: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1 rounded font-['Inter:Medium',sans-serif] font-medium text-[15px] ${
        active
          ? isDark
            ? "bg-[oklch(0.985_0_0)] text-[oklch(0.205_0_0)]"
            : "bg-[#030213] text-white"
          : isDark
            ? "text-white hover:bg-[oklch(0.269_0_0)]"
            : "text-[#0a0a0a] hover:bg-[#ececf0]"
      }`}
    >
      {children}
    </button>
  );
}

function ChatMessage({
  role,
  message,
  time,
  align,
  isDark,
}: {
  role: string;
  message: string;
  time: string;
  align: "left" | "right";
  isDark: boolean;
}) {
  const isUser = align === "right";

  return (
    <div
      className={`flex flex-col gap-[4px] ${isUser ? "items-end" : "items-start"} w-full`}
    >
      {!isUser && (
        <div className="h-[20px] relative">
          <p className="font-['Inter:Regular',sans-serif] font-normal leading-[20px] text-[#717182] text-[14px] tracking-[-0.1504px] whitespace-nowrap pl-[8px]">
            {role}
          </p>
        </div>
      )}
      <div
        className={`rounded-[8px] px-4 py-2 flex-[1_0_0] ${
          isUser
            ? isDark
              ? "bg-[oklch(0.985_0_0)]"
              : "bg-[#030213]"
            : isDark
              ? "bg-[oklch(0.269_0_0)]"
              : "bg-[#ececf0]"
        }`}
      >
        <div className="flex flex-col gap-[4px]">
          <p
            className={`font-['Inter:Regular',sans-serif] font-normal leading-[24px] tracking-[-0.3125px] ${
              isUser
                ? isDark
                  ? "text-[oklch(0.205_0_0)]"
                  : "text-[oklch(1_0_0)]"
                : isDark
                  ? "text-[oklch(0.985_0_0)]"
                  : "text-[oklch(0.145_0_0)]"
            }`}
          >
            {message}
          </p>
          <p
            className={`font-['Inter:Regular',sans-serif] font-normal leading-[16px] text-[12px] ${
              isUser
                ? isDark
                  ? "text-[oklch(0.205_0_0)]"
                  : "text-[rgba(255,255,255,0.7)]"
                : "text-[#717182]"
            }`}
          >
            {time}
          </p>
        </div>
      </div>
    </div>
  );
}

function ChatTab({ isDark }: { isDark: boolean }) {
  const messages = [
    {
      role: "Sarah Chen",
      message: "Hey team! How is everyone doing today?",
      time: "1h ago",
      align: "left" as const,
    },
    {
      role: "You",
      message: "Great! Just finished the new design mockups.",
      time: "1h ago",
      align: "right" as const,
    },
    {
      role: "Mike Johnson",
      message:
        "Awesome! Can you share them in the file section?",
      time: "1h ago",
      align: "left" as const,
    },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto pt-[24px] px-[16px] space-y-[16px]">
        {messages.map((msg, idx) => (
          <ChatMessage key={idx} {...msg} isDark={isDark} />
        ))}
      </div>

      <div
        className={`border-t px-4 py-2 ${
          isDark
            ? "border-[rgba(255,255,255,0.1)] bg-[oklch(0.269_0_0)]"
            : "border-[rgba(0,0,0,0.1)] bg-[#f3f3f5]"
        }`}
      >
        <p className="font-['Inter:Regular',sans-serif] text-[12px] text-[#717182]">
          Tool status: Ready
        </p>
      </div>

      <div
        className={`border-t px-4 py-2 ${
          isDark
            ? "border-[rgba(255,255,255,0.1)] bg-[oklch(0.145_0_0)]"
            : "border-[rgba(0,0,0,0.1)] bg-white"
        }`}
      >
        <p className="font-['Inter:Regular',sans-serif] text-[12px] text-[#717182]">
          All changes saved
        </p>
      </div>

      <div
        className={`border-t p-4 ${isDark ? "border-[rgba(255,255,255,0.1)]" : "border-[rgba(0,0,0,0.1)]"}`}
      >
        <div className="flex gap-2 items-end">
          <button
            className={`p-2 rounded-md ${
              isDark
                ? "hover:bg-[oklch(0.269_0_0)]"
                : "hover:bg-[#ececf0]"
            }`}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 20 20"
            >
              <path
                d="M0.833334 7.46L7.305 0.833334"
                stroke={isDark ? "oklch(0.985 0 0)" : "#717182"}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.66667"
              />
              <path
                d="M11.6671 4.16595L4.65542 11.321C4.34297 11.6335 4.16745 12.0573 4.16745 12.4993C4.16745 12.9412 4.34297 13.3651 4.65542 13.6776C4.96797 13.9901 5.39182 14.1656 5.83376 14.1656C6.2757 14.1656 6.69954 13.9901 7.01209 13.6776L14.0238 6.52262C14.6487 5.89753 14.9997 5.04983 14.9997 4.16595C14.9997 3.28207 14.6487 2.43438 14.0238 1.80929C13.3987 1.18438 12.551 0.833333 11.6671 0.833333C10.7832 0.833333 9.93552 1.18438 9.31042 1.80929L2.29792 8.96345C1.36016 9.90121 0.833333 11.1731 0.833333 12.4993C0.833333 13.8255 1.36016 15.0974 2.29792 16.0351C3.23568 16.9729 4.50756 17.4997 5.83376 17.4997C7.15995 17.4997 8.43183 16.9729 9.36959 16.0351"
                stroke={isDark ? "oklch(0.985 0 0)" : "#717182"}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.66667"
              />
            </svg>
          </button>
          <textarea
            className={`flex-1 px-4 py-2 rounded-md font-['Inter:Regular',sans-serif] resize-none ${
              isDark
                ? "bg-[oklch(0.269_0_0)] text-white placeholder:text-[#717182]"
                : "bg-[#f3f3f5] text-[#0a0a0a] placeholder:text-[#717182]"
            }`}
            placeholder="Type a message..."
            rows={1}
          />
          <button
            className={`p-2 rounded-md ${
              isDark
                ? "bg-[oklch(0.985_0_0)] hover:bg-[oklch(0.269_0_0)]"
                : "bg-[#030213] hover:bg-[#ececf0]"
            }`}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 20 20"
            >
              <path
                // d={svgPaths.p228d3dc0}
                stroke={isDark ? "oklch(0.205 0 0)" : "white"}
                strokeWidth="1.66667"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                // d={svgPaths.p2920ab80}
                stroke={isDark ? "oklch(0.205 0 0)" : "white"}
                strokeWidth="1.66667"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function PoolItem({
  title,
  metadata,
  isDark,
}: {
  title: string;
  metadata: string;
  isDark: boolean;
}) {
  return (
    <div
      className={`p-4 border-b cursor-pointer ${
        isDark
          ? "border-[rgba(255,255,255,0.1)] hover:bg-[oklch(0.269_0_0)]"
          : "border-[rgba(0,0,0,0.1)] hover:bg-[#ececf0]"
      }`}
    >
      <h3
        className={`font-['Inter:Medium',sans-serif] font-medium ${isDark ? "text-white" : "text-[#0a0a0a]"}`}
      >
        {title}
      </h3>
      <p
        className={`font-['Inter:Regular',sans-serif] text-[14px] mt-1 ${isDark ? "text-[#717182]" : "text-[#717182]"}`}
      >
        {metadata}
      </p>
    </div>
  );
}

function PoolTab({ isDark }: { isDark: boolean }) {
  const poolItems = [
    {
      title: "Design System Update",
      metadata: "Created by Sarah Chen • 2 hours ago",
    },
    {
      title: "Q2 Planning Review",
      metadata: "Created by Mike Johnson • 1 day ago",
    },
    {
      title: "Client Feedback Session",
      metadata: "Created by Emma Davis • 2 days ago",
    },
  ];

  return (
    <div className="h-full overflow-y-auto">
      {poolItems.map((item, idx) => (
        <PoolItem key={idx} {...item} isDark={isDark} />
      ))}
    </div>
  );
}

function TimelineItem({
  time,
  title,
  description,
  isDark,
}: {
  time: string;
  title: string;
  description: string;
  isDark: boolean;
}) {
  return (
    <div
      className={`flex gap-4 p-4 border-b ${isDark ? "border-[rgba(255,255,255,0.1)]" : "border-[rgba(0,0,0,0.1)]"}`}
    >
      <div className="w-[100px] shrink-0">
        <p
          className={`font-['Inter:Medium',sans-serif] font-medium ${isDark ? "text-white" : "text-[#0a0a0a]"}`}
        >
          {time}
        </p>
      </div>
      <div className="flex-1">
        <h3
          className={`font-['Inter:Medium',sans-serif] font-medium ${isDark ? "text-white" : "text-[#0a0a0a]"}`}
        >
          {title}
        </h3>
        <p
          className={`font-['Inter:Regular',sans-serif] text-[14px] mt-1 ${isDark ? "text-[#717182]" : "text-[#717182]"}`}
        >
          {description}
        </p>
      </div>
    </div>
  );
}

function TimelineTab({ isDark }: { isDark: boolean }) {
  const events = [
    {
      time: "10:30 AM",
      title: "Design Review",
      description: "Sarah shared new mockups in chat",
    },
    {
      time: "11:45 AM",
      title: "Code Review",
      description: "Mike approved pull request #234",
    },
    {
      time: "2:00 PM",
      title: "Client Call",
      description: "Meeting with stakeholders scheduled",
    },
  ];

  return (
    <div className="h-full overflow-y-auto">
      {events.map((event, idx) => (
        <TimelineItem key={idx} {...event} isDark={isDark} />
      ))}
    </div>
  );
}

function TaskItem({
  title,
  status,
  isDark,
}: {
  title: string;
  status: string;
  isDark: boolean;
}) {
  return (
    <div
      className={`p-4 border-b cursor-pointer ${
        isDark
          ? "border-[rgba(255,255,255,0.1)] hover:bg-[oklch(0.269_0_0)]"
          : "border-[rgba(0,0,0,0.1)] hover:bg-[#ececf0]"
      }`}
    >
      <h3
        className={`font-['Inter:Medium',sans-serif] font-medium ${isDark ? "text-white" : "text-[#0a0a0a]"}`}
      >
        {title}
      </h3>
      <div className="flex items-center gap-2 mt-1">
        <div
          className={`size-2 rounded-full ${
            status === "Completed"
              ? "bg-green-500"
              : status === "In Progress"
                ? "bg-[oklch(0.145_0_0)]"
                : "bg-[#717182]"
          }`}
        ></div>
        <p
          className={`font-['Inter:Regular',sans-serif] text-[14px] ${isDark ? "text-[#717182]" : "text-[#717182]"}`}
        >
          {status}
        </p>
      </div>
    </div>
  );
}

function TasksTab({ isDark }: { isDark: boolean }) {
  const tasks = [
    { title: "Update user dashboard", status: "In Progress" },
    { title: "Fix navigation bug", status: "Completed" },
    { title: "Review pull requests", status: "Pending" },
    { title: "Write documentation", status: "In Progress" },
  ];

  return (
    <div className="h-full overflow-y-auto">
      {tasks.map((task, idx) => (
        <TaskItem key={idx} {...task} isDark={isDark} />
      ))}
    </div>
  );
}

function MainPanel({ isDark }: { isDark: boolean }) {
  const [activeTab, setActiveTab] = useState<
    "chat" | "pool" | "timeline" | "tasks"
  >("chat");

  return (
    <div
      className={`flex-1 flex flex-col ${isDark ? "bg-[oklch(0.145_0_0)]" : "bg-white"}`}
    >
      <div
        className={`border-b px-2 py-1.5 ${isDark ? "border-[rgba(255,255,255,0.1)]" : "border-[rgba(0,0,0,0.1)]"}`}
      >
        <div className="flex gap-1 items-center">
          <TabButton
            active={activeTab === "chat"}
            onClick={() => setActiveTab("chat")}
            isDark={isDark}
          >
            Chat
          </TabButton>
          <TabButton
            active={activeTab === "pool"}
            onClick={() => setActiveTab("pool")}
            isDark={isDark}
          >
            Pool
          </TabButton>
          <TabButton
            active={activeTab === "timeline"}
            onClick={() => setActiveTab("timeline")}
            isDark={isDark}
          >
            Timeline
          </TabButton>
          <TabButton
            active={activeTab === "tasks"}
            onClick={() => setActiveTab("tasks")}
            isDark={isDark}
          >
            Tasks
          </TabButton>
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === "chat" && <ChatTab isDark={isDark} />}
        {activeTab === "pool" && <PoolTab isDark={isDark} />}
        {activeTab === "timeline" && (
          <TimelineTab isDark={isDark} />
        )}
        {activeTab === "tasks" && <TasksTab isDark={isDark} />}
      </div>
    </div>
  );
}

export default function App() {
  const [isDark, setIsDark] = useState(false);

  const toggleTheme = () => setIsDark(!isDark);

  return (
    <div
      className={`size-full flex flex-col ${isDark ? "bg-[oklch(0.145_0_0)]" : "bg-white"}`}
    >
      <TopBar isDark={isDark} toggleTheme={toggleTheme} />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar isDark={isDark} />
        <MainPanel isDark={isDark} />
      </div>
    </div>
  );
}