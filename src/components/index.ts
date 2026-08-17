// Convenience barrel for the lazy page chunks.
//
// Deliberately NOT re-exported here: DraftTable and TeamCard, and anything
// else that pulls the full draft pool or another heavy dependency. A barrel is
// a single module to the bundler, so one eager importer of any name in it
// drags the whole graph behind every name into the entry chunk. That is how
// the ~450KB pool JSON ended up loading on routes that never render a player.
// Import those directly from their own file, and keep the always-mounted shell
// (App.tsx, HomePage) off this barrel entirely.
export { Header } from './Header';
export { YearSelector } from './YearSelector';
export { SeasonLoadingOverlay } from './SeasonLoadingOverlay';
export { LeagueForm } from './LeagueForm';
export { WaiverTable } from './WaiverTable';
export { TradeTable } from './TradeTable';
export { RivalryCard } from './RivalryCard';
export { NflTeamLabel } from './NflTeamLabel';
export { PosBadge } from './PosBadge';
export { TeamLink } from './TeamLink';
export { LuckIcon } from './LuckIcon';
