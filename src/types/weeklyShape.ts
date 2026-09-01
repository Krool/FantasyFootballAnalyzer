// The bundled weekly projection shape (see scripts/updateWeeklyShape.ts).
export interface WeeklyShapeFile {
  season: number;
  generatedAt: string;
  // How many weeks each player array covers (index 0 = week 1).
  weeks: number;
  // Pool player id slug -> projected half-PPR points per week. A zero week
  // is a bye, a suspension, or a projected absence. Players the source
  // projects for zero points all season are absent entirely.
  players: Record<string, number[]>;
}
