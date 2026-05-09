type CitationTier = 'personal' | 'pool' | 'timeline'

type CitationChipProps = {
  label: string
  tier: CitationTier
}

function CitationChip({ label, tier }: CitationChipProps): React.JSX.Element {
  return (
    <span className={`citation-chip citation-chip--${tier}`}>
      {label} · {tier}
    </span>
  )
}

export type { CitationTier }
export default CitationChip
