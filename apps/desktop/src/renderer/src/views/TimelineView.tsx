import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TeamPulseResponse = Awaited<ReturnType<typeof window.api.loadTeamPulse>>;
type TeamPulseMember = TeamPulseResponse["members"][number];
type TeamPulseCell = TeamPulseMember["cells"][number];

const TIMELINE_BUCKET_SIZE = 3600;
const TIMELINE_BUCKET_COUNT = 24 * 7;

type DayCell = {
  dayKey: string;
  dayLabel: string;
  detailLabel: string;
  eventCount: number;
  summary: string | null;
  updatedAt: string | null;
};

type DayMember = {
  agent_id: string;
  display_name: string;
  cells: DayCell[];
};

type DayPulse = {
  days: Array<{ key: string; label: string; detailLabel: string }>;
  members: DayMember[];
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === "") return "·";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function dayKeyFromIso(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  })
    .format(date)
    .toLowerCase();
}

function formatDetailDayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatUpdated(value: string | null): string {
  if (!value) return "not captured";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).format(date);
}

function mergeSummaries(cells: TeamPulseCell[]): string | null {
  const unique = cells
    .map((cell) => cell.summary?.trim())
    .filter((value): value is string => Boolean(value));
  if (unique.length === 0) return null;
  const deduped = [...new Set(unique)];
  if (deduped.length === 1) return deduped[0]!;
  return deduped.slice(0, 3).join(" · ");
}

function latestUpdatedAt(cells: TeamPulseCell[]): string | null {
  const timestamps = cells
    .map((cell) => cell.updated_at)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value));
  if (timestamps.length === 0) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function aggregatePulseByDay(pulse: TeamPulseResponse): DayPulse {
  const orderedDays: Array<{ key: string; label: string; detailLabel: string }> = [];
  const seenDays = new Set<string>();

  pulse.bucket_starts.forEach((bucketStart) => {
    const key = dayKeyFromIso(bucketStart);
    if (seenDays.has(key)) return;
    seenDays.add(key);
    orderedDays.push({
      key,
      label: formatDayLabel(bucketStart),
      detailLabel: formatDetailDayLabel(bucketStart),
    });
  });

  const members = pulse.members.map((member) => {
    const byDay = new Map<string, TeamPulseCell[]>();
    pulse.bucket_starts.forEach((bucketStart, index) => {
      const key = dayKeyFromIso(bucketStart);
      const group = byDay.get(key) ?? [];
      group.push(member.cells[index]!);
      byDay.set(key, group);
    });

    return {
      agent_id: member.agent_id,
      display_name: member.display_name,
      cells: orderedDays.map((day) => {
        const dayCells = byDay.get(day.key) ?? [];
        return {
          dayKey: day.key,
          dayLabel: day.label,
          detailLabel: day.detailLabel,
          eventCount: dayCells.reduce((sum, cell) => sum + (cell.event_count || 0), 0),
          summary: mergeSummaries(dayCells),
          updatedAt: latestUpdatedAt(dayCells),
        };
      }),
    };
  });

  return { days: orderedDays, members };
}

type TimelineViewProps = {
  projectFolderPath: string | null;
};

function TimelineView(_props: TimelineViewProps): React.JSX.Element {
  const [pulse, setPulse] = useState<TeamPulseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<{
    memberId: string;
    dayIndex: number;
  } | null>(null);
  const [hover, setHover] = useState<{
    memberId: string;
    dayIndex: number;
    x: number;
    y: number;
  } | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const loadPulse = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const next = await window.api.loadTeamPulse({
        bucketSize: TIMELINE_BUCKET_SIZE,
        bucketCount: TIMELINE_BUCKET_COUNT,
      });
      setPulse(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshPulse = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    setError(null);
    try {
      await window.api.refreshTeamPulse({
        bucketSize: TIMELINE_BUCKET_SIZE,
        bucketCount: TIMELINE_BUCKET_COUNT,
      });
      const next = await window.api.loadTeamPulse({
        bucketSize: TIMELINE_BUCKET_SIZE,
        bucketCount: TIMELINE_BUCKET_COUNT,
      });
      setPulse(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadPulse();
    void window.api
      .refreshTeamPulse({
        bucketSize: TIMELINE_BUCKET_SIZE,
        bucketCount: TIMELINE_BUCKET_COUNT,
      })
      .then(loadPulse)
      .catch(() => undefined);
  }, [loadPulse]);

  const dayPulse = useMemo(() => (pulse ? aggregatePulseByDay(pulse) : null), [pulse]);

  const globalMax = useMemo(() => {
    if (!dayPulse) return 1;
    let max = 1;
    for (const member of dayPulse.members) {
      for (const cell of member.cells) if (cell.eventCount > max) max = cell.eventCount;
    }
    return max;
  }, [dayPulse]);

  const selectedDetail = useMemo(() => {
    if (!dayPulse || !selected) return null;
    const member = dayPulse.members.find((item) => item.agent_id === selected.memberId);
    if (!member) return null;
    const cell = member.cells[selected.dayIndex];
    if (!cell) return null;
    return { member, cell };
  }, [dayPulse, selected]);

  if (loading && !pulse) {
    return (
      <section className="content-panel pulse">
        <PulseToolbar onRefresh={() => void loadPulse()} refreshing={false} />
        <div className="pulse__loading">
          {Array.from({ length: 4 }).map((_, i) => (
            <div className="pulse__skeleton-row" key={i}>
              <div className="pulse__skeleton-name" />
              <div className="pulse__skeleton-track" />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (error && !pulse) {
    return (
      <section className="content-panel pulse">
        <PulseToolbar onRefresh={() => void loadPulse()} refreshing={false} />
        <div className="pulse__error">
          <p className="pulse__error-msg">{error}</p>
          <button
            type="button"
            className="pulse__btn pulse__btn--primary"
            onClick={() => void loadPulse()}
          >
            try again
          </button>
        </div>
      </section>
    );
  }

  if (!dayPulse || dayPulse.members.length === 0) {
    return (
      <section className="content-panel pulse">
        <PulseToolbar onRefresh={() => void refreshPulse()} refreshing={refreshing} />
        <div className="pulse__empty">
          <svg
            className="pulse__empty-line"
            viewBox="0 0 200 40"
            preserveAspectRatio="none"
          >
            <path d="M0,20 L60,20 L70,8 L80,32 L90,12 L100,28 L110,20 L200,20" />
          </svg>
          <p>no members yet - invite teammates to start the timeline.</p>
        </div>
      </section>
    );
  }

  const dayCount = dayPulse.days.length;

  return (
    <section className="content-panel pulse">
      <PulseToolbar onRefresh={() => void refreshPulse()} refreshing={refreshing} />

      {error && <div className="pulse__inline-error">{error}</div>}

      <div className="pulse__board">
        <div className="pulse__axis" aria-hidden="true">
          <div className="pulse__axis-corner" />
          <div className="pulse__axis-track" style={{ ["--cols" as string]: dayCount }}>
            {dayPulse.days.map((day, index) => (
              <div
                key={day.key}
                className="pulse__axis-day pulse__axis-day--wide"
                style={{ ["--col-start" as string]: index + 1 }}
              >
                <span>{day.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="pulse__lanes" ref={gridRef}>
          {dayPulse.members.map((member, memberIdx) => {
            const memberMax = Math.max(1, ...member.cells.map((cell) => cell.eventCount || 0));
            const lastCell = member.cells[dayCount - 1];
            const isLive = (lastCell?.eventCount ?? 0) > 0;
            const memberTotal = member.cells.reduce((sum, cell) => sum + (cell.eventCount || 0), 0);
            const isExpanded = selectedDetail?.member.agent_id === member.agent_id;

            return (
              <div
                key={member.agent_id}
                className={`pulse__lane${isExpanded ? " pulse__lane--expanded" : ""}`}
                style={{ ["--lane-delay" as string]: `${memberIdx * 40}ms` }}
              >
                <div className="pulse__name">
                  <span
                    className={`pulse__avatar${isLive ? " pulse__avatar--live" : ""}`}
                    aria-hidden="true"
                  >
                    {initials(member.display_name)}
                  </span>
                  <span className="pulse__name-text">
                    <span className="pulse__name-primary">{member.display_name}</span>
                    <span className="pulse__name-secondary">
                      {memberTotal} event{memberTotal === 1 ? "" : "s"} this week
                    </span>
                  </span>
                </div>

                <div
                  className="pulse__track pulse__track--week"
                  style={{ ["--cols" as string]: dayCount }}
                  onMouseLeave={() => setHover(null)}
                >
                  {member.cells.map((cell, index) => {
                    const isEmpty = !cell.summary || cell.eventCount === 0;
                    const intensity = isEmpty
                      ? 0
                      : 0.18 + 0.82 * (cell.eventCount / memberMax);
                    const globalIntensity = isEmpty ? 0 : cell.eventCount / globalMax;
                    const isSelected =
                      selected?.memberId === member.agent_id && selected.dayIndex === index;

                    return (
                      <button
                        key={cell.dayKey}
                        type="button"
                        className={`pulse__cell pulse__cell--day${isEmpty ? " pulse__cell--empty" : ""}${isSelected ? " pulse__cell--selected" : ""}`}
                        style={{
                          ["--intensity" as string]: intensity.toFixed(3),
                          ["--global-intensity" as string]: globalIntensity.toFixed(3),
                        }}
                        disabled={isEmpty}
                        onClick={() => {
                          if (isEmpty) return;
                          setSelected((prev) =>
                            prev?.memberId === member.agent_id && prev.dayIndex === index
                              ? null
                              : { memberId: member.agent_id, dayIndex: index },
                          );
                        }}
                        onMouseEnter={(event) => {
                          if (isEmpty) {
                            setHover(null);
                            return;
                          }
                          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
                          const containerRect = gridRef.current?.getBoundingClientRect();
                          setHover({
                            memberId: member.agent_id,
                            dayIndex: index,
                            x: rect.left + rect.width / 2 - (containerRect?.left ?? 0),
                            y: rect.top - (containerRect?.top ?? 0),
                          });
                        }}
                        aria-label={
                          isEmpty
                            ? `${member.display_name} - no events on ${cell.detailLabel}`
                            : `${member.display_name} on ${cell.detailLabel}: ${cell.summary}`
                        }
                      >
                        <span className="pulse__cell-fill" />
                        {!isEmpty && (
                          <span className="pulse__cell-count">{cell.eventCount}</span>
                        )}
                      </button>
                    );
                  })}

                  {hover &&
                    hover.memberId === member.agent_id &&
                    (() => {
                      const cell = member.cells[hover.dayIndex];
                      if (!cell || !cell.summary) return null;
                      return (
                        <div
                          className="pulse__tooltip"
                          style={{
                            left: `${hover.x}px`,
                            top: `${hover.y}px`,
                          }}
                        >
                          <span className="pulse__tooltip-time">{cell.detailLabel}</span>
                          <span className="pulse__tooltip-summary">{cell.summary}</span>
                          <span className="pulse__tooltip-meta">
                            {cell.eventCount} event{cell.eventCount === 1 ? "" : "s"}
                          </span>
                        </div>
                      );
                    })()}
                </div>

                {isExpanded && selectedDetail && (
                  <div className="pulse__detail">
                    <div className="pulse__detail-meta">
                      <span className="pulse__detail-time">
                        {selectedDetail.cell.detailLabel}
                      </span>
                      <span className="pulse__detail-count">
                        {selectedDetail.cell.eventCount} event
                        {selectedDetail.cell.eventCount === 1 ? "" : "s"}
                      </span>
                      <button
                        type="button"
                        className="pulse__detail-close"
                        onClick={() => setSelected(null)}
                        aria-label="close detail"
                      >
                        x
                      </button>
                    </div>
                    <p className="pulse__detail-summary">{selectedDetail.cell.summary}</p>
                    {selectedDetail.cell.updatedAt && (
                      <p className="pulse__detail-updated">
                        captured {formatUpdated(selectedDetail.cell.updatedAt)}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function PulseToolbar({
  onRefresh,
  refreshing,
}: {
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  return (
    <div className="pulse__toolbar">
      <button
        type="button"
        className="pulse__btn"
        onClick={onRefresh}
        disabled={refreshing}
      >
        <span
          className={`pulse__btn-spark${refreshing ? " pulse__btn-spark--spin" : ""}`}
        />
        {refreshing ? "refreshing" : "refresh"}
      </button>
    </div>
  );
}

export default TimelineView;
