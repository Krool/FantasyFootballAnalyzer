import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { League } from '@/types';
import { gradeAllPicks, calculateDraftSummary, getGradeDisplayText } from './grading';

export function exportLeagueReport(league: League) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();

  // Title
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text(league.name, pageWidth / 2, 20, { align: 'center' });

  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(`${league.season} Season Report`, pageWidth / 2, 28, { align: 'center' });
  doc.text(`Platform: ${league.platform.toUpperCase()} | Teams: ${league.totalTeams}`, pageWidth / 2, 35, { align: 'center' });

  let yPos = 45;

  // League Standings
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('League Standings', 14, yPos);
  yPos += 5;

  const standingsData = [...league.teams]
    .sort((a, b) => {
      const aWins = a.wins || 0;
      const bWins = b.wins || 0;
      if (aWins !== bWins) return bWins - aWins;
      return (b.pointsFor || 0) - (a.pointsFor || 0);
    })
    .map((team, index) => [
      String(index + 1),
      team.name,
      `${team.wins || 0}-${team.losses || 0}${team.ties ? `-${team.ties}` : ''}`,
      (team.pointsFor || 0).toFixed(1),
      (team.pointsAgainst || 0).toFixed(1),
    ]);

  autoTable(doc, {
    startY: yPos,
    head: [['Rank', 'Team', 'Record', 'PF', 'PA']],
    body: standingsData,
    theme: 'striped',
    headStyles: { fillColor: [59, 130, 246] },
    styles: { fontSize: 9 },
  });

  yPos = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15;

  // Draft Grades Summary
  if (yPos > 240) {
    doc.addPage();
    yPos = 20;
  }

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Draft Grade Summary', 14, yPos);
  yPos += 5;

  const mockLeague = { ...league };
  const gradedPicks = gradeAllPicks(mockLeague);

  const draftSummaryData = league.teams.map(team => {
    const teamPicks = gradedPicks.filter(p => p.teamId === team.id);
    const summary = calculateDraftSummary(teamPicks);
    return [
      team.name,
      String(summary.great),
      String(summary.good),
      String(summary.bad),
      String(summary.terrible),
      summary.averageValue >= 0 ? `+${summary.averageValue.toFixed(1)}` : summary.averageValue.toFixed(1),
    ];
  }).sort((a, b) => parseFloat(b[5]) - parseFloat(a[5]));

  autoTable(doc, {
    startY: yPos,
    head: [['Team', 'Great', 'Good', 'Bad', 'Terrible', 'Avg Value']],
    body: draftSummaryData,
    theme: 'striped',
    headStyles: { fillColor: [59, 130, 246] },
    styles: { fontSize: 9 },
  });

  yPos = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15;

  // Top Draft Picks
  if (yPos > 200) {
    doc.addPage();
    yPos = 20;
  }

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Top 10 Draft Picks (by Value)', 14, yPos);
  yPos += 5;

  const topPicks = [...gradedPicks]
    .sort((a, b) => b.valueOverExpected - a.valueOverExpected)
    .slice(0, 10)
    .map((pick, index) => [
      String(index + 1),
      pick.player.name,
      pick.player.position,
      pick.teamName,
      String(pick.pickNumber),
      (pick.seasonPoints || 0).toFixed(1),
      getGradeDisplayText(pick.grade),
    ]);

  autoTable(doc, {
    startY: yPos,
    head: [['#', 'Player', 'Pos', 'Team', 'Pick', 'Points', 'Grade']],
    body: topPicks,
    theme: 'striped',
    headStyles: { fillColor: [34, 197, 94] },
    styles: { fontSize: 9 },
  });

  yPos = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15;

  // Worst Draft Picks
  if (yPos > 200) {
    doc.addPage();
    yPos = 20;
  }

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Bottom 10 Draft Picks (by Value)', 14, yPos);
  yPos += 5;

  const worstPicks = [...gradedPicks]
    .sort((a, b) => a.valueOverExpected - b.valueOverExpected)
    .slice(0, 10)
    .map((pick, index) => [
      String(index + 1),
      pick.player.name,
      pick.player.position,
      pick.teamName,
      String(pick.pickNumber),
      (pick.seasonPoints || 0).toFixed(1),
      getGradeDisplayText(pick.grade),
    ]);

  autoTable(doc, {
    startY: yPos,
    head: [['#', 'Player', 'Pos', 'Team', 'Pick', 'Points', 'Grade']],
    body: worstPicks,
    theme: 'striped',
    headStyles: { fillColor: [239, 68, 68] },
    styles: { fontSize: 9 },
  });

  yPos = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15;

  // Waiver Wire Summary
  if (yPos > 200) {
    doc.addPage();
    yPos = 20;
  }

  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Waiver Wire Performance', 14, yPos);
  yPos += 5;

  const waiverData = league.teams.map(team => {
    const transactions = team.transactions || [];
    const waiverPickups = transactions.filter(tx => tx.type === 'waiver' || tx.type === 'free_agent');
    const totalPoints = waiverPickups.reduce((sum, tx) => sum + (tx.totalPointsGenerated || 0), 0);
    const totalPickups = waiverPickups.reduce((sum, tx) => sum + tx.adds.length, 0);
    return {
      name: team.name,
      pickups: totalPickups,
      points: totalPoints,
    };
  }).sort((a, b) => b.points - a.points);

  autoTable(doc, {
    startY: yPos,
    head: [['Rank', 'Team', 'Pickups', 'Points Generated']],
    body: waiverData.map((team, index) => [
      String(index + 1),
      team.name,
      String(team.pickups),
      team.points.toFixed(1),
    ]),
    theme: 'striped',
    headStyles: { fillColor: [59, 130, 246] },
    styles: { fontSize: 9 },
  });

  yPos = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 15;

  // Trades Summary
  if (league.trades && league.trades.length > 0) {
    if (yPos > 200) {
      doc.addPage();
      yPos = 20;
    }

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Trade Summary', 14, yPos);
    yPos += 5;

    const tradeStats = new Map<string, { wins: number; losses: number; netPoints: number }>();
    league.teams.forEach(team => {
      tradeStats.set(team.id, { wins: 0, losses: 0, netPoints: 0 });
    });

    league.trades.forEach(trade => {
      trade.teams.forEach(t => {
        const current = tradeStats.get(t.teamId) || { wins: 0, losses: 0, netPoints: 0 };
        if (trade.winner === t.teamId) current.wins++;
        else if (trade.winner) current.losses++;
        current.netPoints += t.netValue;
        tradeStats.set(t.teamId, current);
      });
    });

    const tradeData = Array.from(tradeStats.entries())
      .map(([teamId, stats]) => {
        const team = league.teams.find(t => t.id === teamId);
        return {
          name: team?.name || teamId,
          ...stats,
        };
      })
      .sort((a, b) => b.netPoints - a.netPoints);

    autoTable(doc, {
      startY: yPos,
      head: [['Rank', 'Team', 'Wins', 'Losses', 'Net Points']],
      body: tradeData.map((team, index) => [
        String(index + 1),
        team.name,
        String(team.wins),
        String(team.losses),
        team.netPoints >= 0 ? `+${team.netPoints.toFixed(1)}` : team.netPoints.toFixed(1),
      ]),
      theme: 'striped',
      headStyles: { fillColor: [139, 92, 246] },
      styles: { fontSize: 9 },
    });
  }

  // Footer
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `Generated by Fantasy Football Analyzer | Page ${i} of ${pageCount}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' }
    );
  }

  // Save
  doc.save(`${league.name.replace(/[^a-z0-9]/gi, '_')}_${league.season}_Report.pdf`);
}
