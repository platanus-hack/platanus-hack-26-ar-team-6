import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TeamPulseResponse = Awaited<ReturnType<typeof window.api.loadTeamPulse>>;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === "") return "·";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

function formatHour(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
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

type DayBoundary = {
  index: number;
  label: string;
};

function computeDayBoundaries(buckets: string[]): DayBoundary[] {
  const out: DayBoundary[] = [];
  let lastDay = "";
  buckets.forEach((iso, index) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return;
    const day = d.toDateString();
    if (day !== lastDay) {
      out.push({ index, label: formatDayLabel(iso) });
      lastDay = day;
    }
  });
  return out;
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
    bucketIndex: number;
  } | null>(null);
  const [hover, setHover] = useState<{
    memberId: string;
    bucketIndex: number;
    x: number;
    y: number;
  } | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const loadPulse = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const next = await window.api.loadTeamPulse({
        bucketSize: 3600,
        bucketCount: 24,
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
      await window.api.refreshTeamPulse({ bucketSize: 3600, bucketCount: 24 });
      const next = await window.api.loadTeamPulse({
        bucketSize: 3600,
        bucketCount: 24,
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
      .refreshTeamPulse({ bucketSize: 3600, bucketCount: 24 })
      .then(loadPulse)
      .catch(() => undefined);
  }, [loadPulse]);

  const dayBoundaries = useMemo(
    () => (pulse ? computeDayBoundaries(pulse.bucket_starts) : []),
    [pulse],
  );

  const globalMax = useMemo(() => {
    if (!pulse) return 1;
    let max = 1;
    for (const m of pulse.members) {
      for (const c of m.cells) if (c.event_count > max) max = c.event_count;
    }
    return max;
  }, [pulse]);

  const selectedDetail = useMemo(() => {
    if (!pulse || !selected) return null;
    const member = pulse.members.find((m) => m.agent_id === selected.memberId);
    if (!member) return null;
    const cell = member.cells[selected.bucketIndex];
    const bucketStart = pulse.bucket_starts[selected.bucketIndex];
    if (!cell || !bucketStart) return null;
    return { member, cell, bucketStart };
  }, [pulse, selected]);

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

  if (!pulse || pulse.members.length === 0) {
    return (
      <section className="content-panel pulse">
        <PulseToolbar
          onRefresh={() => void refreshPulse()}
          refreshing={refreshing}
        />
        <div className="pulse__empty">
          <svg
            className="pulse__empty-line"
            viewBox="0 0 200 40"
            preserveAspectRatio="none"
          >
            <path d="M0,20 L60,20 L70,8 L80,32 L90,12 L100,28 L110,20 L200,20" />
          </svg>
          <p>no members yet — invite teammates to start the pulse.</p>
        </div>
      </section>
    );
  }

  const bucketCount = pulse.bucket_starts.length;
  const lastIndex = bucketCount - 1;

  return (
    <section className="content-panel pulse">
      <PulseToolbar
        onRefresh={() => void refreshPulse()}
        refreshing={refreshing}
      />

      {error && <div className="pulse__inline-error">{error}</div>}

      <div className="pulse__board">
        <div className="pulse__axis" aria-hidden="true">
          <div className="pulse__axis-corner" />
          <div
            className="pulse__axis-track"
            style={{ ["--cols" as string]: bucketCount }}
          >
            {dayBoundaries.map((b) => (
              <div
                key={b.index}
                className="pulse__axis-day"
                style={{ ["--col-start" as string]: b.index + 1 }}
              >
                <span>{b.label}</span>
              </div>
            ))}
            {pulse.bucket_starts.map((iso, i) => (
              <div
                key={iso}
                className={`pulse__axis-tick${i === lastIndex ? " pulse__axis-tick--now" : ""}`}
                style={{ ["--col-start" as string]: i + 1 }}
              >
                <span className="pulse__axis-time">{formatHour(iso)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="pulse__lanes" ref={gridRef}>
          {pulse.members.map((member, memberIdx) => {
            const memberMax = Math.max(
              1,
              ...member.cells.map((cell) => cell.event_count || 0),
            );
            const lastCell = member.cells[lastIndex];
            const isLive = (lastCell?.event_count ?? 0) > 0;
            const memberTotal = member.cells.reduce(
              (s, x) => s + (x.event_count || 0),
              0,
            );
            const isExpanded =
              selectedDetail?.member.agent_id === member.agent_id;
            return (
              <div
                key={member.agent_id}
                className={`pulse__lane${isExpanded ? " pulse__lane--expanded" : ""}`}
                style={{
                  ["--lane-delay" as string]: `${memberIdx * 40}ms`,
                }}
              >
                <div className="pulse__name">
                  <span
                    className={`pulse__avatar${isLive ? " pulse__avatar--live" : ""}`}
                    aria-hidden="true"
                  >
                    {initials(member.display_name)}
                  </span>
                  <span className="pulse__name-text">
                    <span className="pulse__name-primary">
                      {member.display_name}
                    </span>
                    <span className="pulse__name-secondary">
                      {memberTotal} event{memberTotal === 1 ? "" : "s"}
                    </span>
                  </span>
                </div>

                <div
                  className="pulse__track"
                  style={{ ["--cols" as string]: bucketCount }}
                  onMouseLeave={() => setHover(null)}
                >
                  {member.cells.map((cell, i) => {
                    const isEmpty = !cell.summary || cell.event_count === 0;
                    const intensity = isEmpty
                      ? 0
                      : 0.18 + 0.82 * (cell.event_count / memberMax);
                    const globalIntensity = isEmpty
                      ? 0
                      : cell.event_count / globalMax;
                    const isSelected =
                      selected?.memberId === member.agent_id &&
                      selected.bucketIndex === i;
                    const isDayStart = dayBoundaries.some(
                      (b) => b.index === i && i !== 0,
                    );
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`pulse__cell${isEmpty ? " pulse__cell--empty" : ""}${isSelected ? " pulse__cell--selected" : ""}${isDayStart ? " pulse__cell--day-start" : ""}`}
                        style={{
                          ["--intensity" as string]: intensity.toFixed(3),
                          ["--global-intensity" as string]:
                            globalIntensity.toFixed(3),
                        }}
                        disabled={isEmpty}
                        onClick={() => {
                          if (isEmpty) return;
                          setSelected((prev) =>
                            prev?.memberId === member.agent_id &&
                            prev.bucketIndex === i
                              ? null
                              : { memberId: member.agent_id, bucketIndex: i },
                          );
                        }}
                        onMouseEnter={(e) => {
                          if (isEmpty) {
                            setHover(null);
                            return;
                          }
                          const rect = (
                            e.currentTarget as HTMLElement
                          ).getBoundingClientRect();
                          const containerRect =
                            gridRef.current?.getBoundingClientRect();
                          setHover({
                            memberId: member.agent_id,
                            bucketIndex: i,
                            x:
                              rect.left +
                              rect.width / 2 -
                              (containerRect?.left ?? 0),
                            y: rect.top - (containerRect?.top ?? 0),
                          });
                        }}
                        aria-label={
                          isEmpty
                            ? `${member.display_name} — no events at ${formatHour(pulse.bucket_starts[i] ?? "")}`
                            : `${member.display_name} at ${formatHour(pulse.bucket_starts[i] ?? "")}: ${cell.summary}`
                        }
                      >
                        <span className="pulse__cell-fill" />
                        {!isEmpty && cell.event_count > 1 && (
                          <span className="pulse__cell-count">
                            {cell.event_count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {hover &&
                    hover.memberId === member.agent_id &&
                    (() => {
                      const cell = member.cells[hover.bucketIndex];
                      const bucketStart =
                        pulse.bucket_starts[hover.bucketIndex];
                      if (!cell || !bucketStart || !cell.summary) return null;
                      return (
                        <div
                          className="pulse__tooltip"
                          style={{
                            left: `${hover.x}px`,
                            top: `${hover.y}px`,
                          }}
                        >
                          <span className="pulse__tooltip-time">
                            {formatHour(bucketStart)}
                          </span>
                          <span className="pulse__tooltip-summary">
                            {cell.summary}
                          </span>
                          <span className="pulse__tooltip-meta">
                            {cell.event_count} event
                            {cell.event_count === 1 ? "" : "s"}
                          </span>
                        </div>
                      );
                    })()}
                </div>

                {isExpanded && selectedDetail && (
                  <div className="pulse__detail">
                    <div className="pulse__detail-meta">
                      <span className="pulse__detail-time">
                        {formatDayLabel(selectedDetail.bucketStart)} ·{" "}
                        {formatHour(selectedDetail.bucketStart)}
                      </span>
                      <span className="pulse__detail-count">
                        {selectedDetail.cell.event_count} event
                        {selectedDetail.cell.event_count === 1 ? "" : "s"}
                      </span>
                      <button
                        type="button"
                        className="pulse__detail-close"
                        onClick={() => setSelected(null)}
                        aria-label="close detail"
                      >
                        ×
                      </button>
                    </div>
                    <p className="pulse__detail-summary">
                      {selectedDetail.cell.summary}
                    </p>
                    {selectedDetail.cell.updated_at && (
                      <p className="pulse__detail-updated">
                        captured{" "}
                        {new Date(
                          selectedDetail.cell.updated_at,
                        ).toLocaleString()}
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
