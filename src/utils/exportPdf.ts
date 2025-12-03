import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { League, Trade } from '@/types';
import { gradeAllPicks, calculateDraftSummary, getGradeDisplayText } from './grading';

// Award types for the first page
interface Award {
  title: string;
  winner: string;
  detail: string;
  icon: string;
}

// Helper to get all waiver pickups with PAR
function getWaiverPickups(league: League) {
  const pickups: Array<{
    playerName: string;
    position: string;
    teamName: string;
    week: number;
    points: number;
    par: number;
    games: number;
  }> = [];

  league.teams.forEach(team => {
    team.transactions?.forEach(tx => {
      if (tx.type === 'waiver' || tx.type === 'free_agent') {
        tx.adds.forEach(player => {
          const points = player.pointsSincePickup ?? 0;
          const par = player.pointsAboveReplacement ?? 0;
          const games = player.gamesSincePickup ?? 0;
          pickups.push({
            playerName: player.name,
            position: player.position,
            teamName: tx.teamName,
            week: tx.week,
            points,
            par,
            games,
          });
        });
      }
    });
  });

  return pickups;
}

// Helper to calculate team waiver stats
function getTeamWaiverStats(league: League) {
  return league.teams.map(team => {
    const transactions = team.transactions || [];
    const waiverPickups = transactions.filter(tx => tx.type === 'waiver' || tx.type === 'free_agent');
    const totalPAR = waiverPickups.reduce((sum, tx) => sum + (tx.totalPAR || 0), 0);
    const totalPoints = waiverPickups.reduce((sum, tx) => sum + (tx.totalPointsGenerated || 0), 0);
    const totalPickups = waiverPickups.reduce((sum, tx) => sum + tx.adds.length, 0);
    const transactionCount = waiverPickups.length;
    return {
      name: team.name,
      pickups: totalPickups,
      transactions: transactionCount,
      points: totalPoints,
      par: totalPAR,
    };
  });
}

// Generate all awards
function generateAwards(league: League): Award[] {
  const awards: Award[] = [];
  const gradedPicks = gradeAllPicks(league);
  const waiverPickups = getWaiverPickups(league);
  const teamWaiverStats = getTeamWaiverStats(league);

  // Best Waiver Pickup (by PAR)
  const bestWaiver = [...waiverPickups].sort((a, b) => b.par - a.par)[0];
  if (bestWaiver) {
    awards.push({
      title: 'Best Waiver Pickup',
      winner: bestWaiver.playerName,
      detail: `${bestWaiver.teamName} | +${bestWaiver.par.toFixed(1)} PAR`,
      icon: '🏆',
    });
  }

  // Worst Waiver Pickup (by PAR, with games played)
  const worstWaiver = [...waiverPickups]
    .filter(p => p.games >= 2) // Must have started at least 2 games
    .sort((a, b) => a.par - b.par)[0];
  if (worstWaiver) {
    awards.push({
      title: 'Worst Waiver Pickup',
      winner: worstWaiver.playerName,
      detail: `${worstWaiver.teamName} | ${worstWaiver.par.toFixed(1)} PAR`,
      icon: '💩',
    });
  }

  // Best Trade (by net PAR)
  if (league.trades && league.trades.length > 0) {
    // Flatten all trade sides
    const allTradeSides: Array<{ trade: Trade; teamName: string; received: string[]; netPAR: number }> = [];
    for (const trade of league.trades) {
      for (const teamSide of trade.teams) {
        allTradeSides.push({
          trade,
          teamName: teamSide.teamName,
          received: teamSide.playersReceived.map(p => p.name),
          netPAR: teamSide.netPAR ?? teamSide.netValue ?? 0,
        });
      }
    }

    if (allTradeSides.length > 0) {
      const bestTradeInfo = allTradeSides.sort((a, b) => b.netPAR - a.netPAR)[0];
      const receivedNames = bestTradeInfo.received.slice(0, 2).join(', ');
      awards.push({
        title: 'Best Trade',
        winner: bestTradeInfo.teamName,
        detail: `Got ${receivedNames} | +${bestTradeInfo.netPAR.toFixed(1)} PAR`,
        icon: '🤝',
      });
    }
  }

  // Best Draft (by average value)
  const teamDraftStats = league.teams.map(team => {
    const teamPicks = gradedPicks.filter(p => p.teamId === team.id);
    const summary = calculateDraftSummary(teamPicks);
    return { name: team.name, avgValue: summary.averageValue, great: summary.great };
  }).sort((a, b) => b.avgValue - a.avgValue);

  if (teamDraftStats.length > 0) {
    const best = teamDraftStats[0];
    awards.push({
      title: 'Best Draft',
      winner: best.name,
      detail: `${best.great} great picks | +${best.avgValue.toFixed(1)} avg value`,
      icon: '📋',
    });
  }

  // Worst Draft
  if (teamDraftStats.length > 0) {
    const worst = teamDraftStats[teamDraftStats.length - 1];
    awards.push({
      title: 'Worst Draft',
      winner: worst.name,
      detail: `${worst.avgValue >= 0 ? '+' : ''}${worst.avgValue.toFixed(1)} avg value`,
      icon: '📉',
    });
  }

  // Most Waiver PAR
  const sortedByPAR = [...teamWaiverStats].sort((a, b) => b.par - a.par);
  if (sortedByPAR.length > 0) {
    const best = sortedByPAR[0];
    awards.push({
      title: 'Waiver Wire King',
      winner: best.name,
      detail: `${best.pickups} pickups | +${best.par.toFixed(1)} PAR`,
      icon: '👑',
    });
  }

  // Least Waiver PAR
  if (sortedByPAR.length > 0) {
    const worst = sortedByPAR[sortedByPAR.length - 1];
    awards.push({
      title: 'Waiver Wire Slacker',
      winner: worst.name,
      detail: `${worst.pickups} pickups | ${worst.par >= 0 ? '+' : ''}${worst.par.toFixed(1)} PAR`,
      icon: '😴',
    });
  }

  // Most Transactions
  const sortedByTx = [...teamWaiverStats].sort((a, b) => b.transactions - a.transactions);
  if (sortedByTx.length > 0) {
    const most = sortedByTx[0];
    awards.push({
      title: 'Most Active',
      winner: most.name,
      detail: `${most.transactions} transactions`,
      icon: '🔥',
    });
  }

  // Least Transactions
  if (sortedByTx.length > 0) {
    const least = sortedByTx[sortedByTx.length - 1];
    awards.push({
      title: 'Least Active',
      winner: least.name,
      detail: `${least.transactions} transactions`,
      icon: '🦥',
    });
  }

  return awards;
}

export function exportLeagueReport(league: League) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // ===== PAGE 1: Title, Awards, Standings, Draft Summary =====

  // Title
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text(league.name, pageWidth / 2, 18, { align: 'center' });

  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text(`${league.season} Season Report`, pageWidth / 2, 25, { align: 'center' });

  // Awards Section
  const awards = generateAwards(league);
  let yPos = 33;

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Season Awards', 14, yPos);
  yPos += 4;

  // Draw awards in a 3-column grid
  const awardColWidth = (pageWidth - 28) / 3;
  const awardHeight = 16;
  let col = 0;
  let awardStartY = yPos;

  awards.forEach((award, index) => {
    const x = 14 + (col * awardColWidth);
    const y = awardStartY + (Math.floor(index / 3) * awardHeight);

    // Award box
    doc.setDrawColor(200, 200, 200);
    doc.setFillColor(250, 250, 250);
    doc.roundedRect(x, y, awardColWidth - 4, awardHeight - 2, 2, 2, 'FD');

    // Icon and title
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text(`${award.icon} ${award.title}`, x + 2, y + 4);

    // Winner
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    doc.text(award.winner, x + 2, y + 9);

    // Detail
    doc.setFontSize(6);
    doc.setTextColor(100, 100, 100);
    doc.text(award.detail, x + 2, y + 13);

    doc.setTextColor(0, 0, 0);

    col++;
    if (col >= 3) col = 0;
  });

  yPos = awardStartY + (Math.ceil(awards.length / 3) * awardHeight) + 6;

  // Standings and Draft Summary side by side
  const halfWidth = (pageWidth - 28) / 2;

  // League Standings (left side)
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Standings', 14, yPos);

  const standingsData = [...league.teams]
    .sort((a, b) => {
      const aWins = a.wins || 0;
      const bWins = b.wins || 0;
      if (aWins !== bWins) return bWins - aWins;
      return (b.pointsFor || 0) - (a.pointsFor || 0);
    })
    .map((team, index) => [
      String(index + 1),
      team.name.length > 14 ? team.name.substring(0, 13) + '.' : team.name,
      `${team.wins || 0}-${team.losses || 0}`,
      (team.pointsFor || 0).toFixed(0),
    ]);

  autoTable(doc, {
    startY: yPos + 2,
    head: [['#', 'Team', 'Record', 'PF']],
    body: standingsData,
    theme: 'striped',
    headStyles: { fillColor: [59, 130, 246], fontSize: 7, cellPadding: 1 },
    styles: { fontSize: 6, cellPadding: 1 },
    columnStyles: {
      0: { cellWidth: 6 },
      1: { cellWidth: halfWidth - 30 },
      2: { cellWidth: 12 },
      3: { cellWidth: 12 },
    },
    tableWidth: halfWidth - 4,
    margin: { left: 14 },
  });

  const standingsEndY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  // Draft Grade Summary (right side)
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('Draft Grades', 14 + halfWidth + 4, yPos);

  const gradedPicks = gradeAllPicks(league);

  const draftSummaryData = league.teams.map(team => {
    const teamPicks = gradedPicks.filter(p => p.teamId === team.id);
    const summary = calculateDraftSummary(teamPicks);
    return {
      name: team.name.length > 12 ? team.name.substring(0, 11) + '.' : team.name,
      great: summary.great,
      good: summary.good,
      bad: summary.bad,
      terrible: summary.terrible,
      avg: summary.averageValue,
    };
  }).sort((a, b) => b.avg - a.avg);

  autoTable(doc, {
    startY: yPos + 2,
    head: [['Team', 'Gr', 'Go', 'Bd', 'Tr', 'Avg']],
    body: draftSummaryData.map(t => [
      t.name,
      String(t.great),
      String(t.good),
      String(t.bad),
      String(t.terrible),
      t.avg >= 0 ? `+${t.avg.toFixed(1)}` : t.avg.toFixed(1),
    ]),
    theme: 'striped',
    headStyles: { fillColor: [59, 130, 246], fontSize: 7, cellPadding: 1 },
    styles: { fontSize: 6, cellPadding: 1 },
    columnStyles: {
      0: { cellWidth: halfWidth - 34 },
      1: { cellWidth: 6 },
      2: { cellWidth: 6 },
      3: { cellWidth: 6 },
      4: { cellWidth: 6 },
      5: { cellWidth: 10 },
    },
    tableWidth: halfWidth - 4,
    margin: { left: 14 + halfWidth + 4 },
  });

  const draftEndY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  yPos = Math.max(standingsEndY, draftEndY) + 8;

  // ===== PAGE 2: Draft Picks =====
  doc.addPage();
  yPos = 18;

  // Top 10 Draft Picks
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Top 10 Draft Picks (by Value)', 14, yPos);
  yPos += 3;

  const topPicks = [...gradedPicks]
    .sort((a, b) => b.valueOverExpected - a.valueOverExpected)
    .slice(0, 10)
    .map((pick, index) => [
      String(index + 1),
      pick.player.name,
      pick.player.position,
      pick.teamName.length > 12 ? pick.teamName.substring(0, 11) + '.' : pick.teamName,
      String(pick.pickNumber),
      (pick.seasonPoints || 0).toFixed(0),
      `+${pick.valueOverExpected}`,
      getGradeDisplayText(pick.grade),
    ]);

  autoTable(doc, {
    startY: yPos,
    head: [['#', 'Player', 'Pos', 'Team', 'Pick', 'Pts', 'Value', 'Grade']],
    body: topPicks,
    theme: 'striped',
    headStyles: { fillColor: [34, 197, 94], fontSize: 8 },
    styles: { fontSize: 7 },
  });

  yPos = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  // Bottom 10 Draft Picks
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Bottom 10 Draft Picks (by Value)', 14, yPos);
  yPos += 3;

  const worstPicks = [...gradedPicks]
    .sort((a, b) => a.valueOverExpected - b.valueOverExpected)
    .slice(0, 10)
    .map((pick, index) => [
      String(index + 1),
      pick.player.name,
      pick.player.position,
      pick.teamName.length > 12 ? pick.teamName.substring(0, 11) + '.' : pick.teamName,
      String(pick.pickNumber),
      (pick.seasonPoints || 0).toFixed(0),
      String(pick.valueOverExpected),
      getGradeDisplayText(pick.grade),
    ]);

  autoTable(doc, {
    startY: yPos,
    head: [['#', 'Player', 'Pos', 'Team', 'Pick', 'Pts', 'Value', 'Grade']],
    body: worstPicks,
    theme: 'striped',
    headStyles: { fillColor: [239, 68, 68], fontSize: 8 },
    styles: { fontSize: 7 },
  });

  yPos = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  // ===== PAGE 3: Waiver Wire =====
  doc.addPage();
  yPos = 18;

  // Best Waiver Pickups
  const waiverPickups = getWaiverPickups(league);

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Best Waiver Pickups (by PAR)', 14, yPos);
  yPos += 3;

  const bestWaivers = [...waiverPickups]
    .sort((a, b) => b.par - a.par)
    .slice(0, 10)
    .map((pickup, index) => [
      String(index + 1),
      pickup.playerName,
      pickup.position,
      pickup.teamName.length > 12 ? pickup.teamName.substring(0, 11) + '.' : pickup.teamName,
      `Wk ${pickup.week}`,
      pickup.points.toFixed(0),
      pickup.games > 0 ? (pickup.points / pickup.games).toFixed(1) : '-',
      `+${pickup.par.toFixed(1)}`,
    ]);

  autoTable(doc, {
    startY: yPos,
    head: [['#', 'Player', 'Pos', 'Team', 'Week', 'Pts', 'PPG', 'PAR']],
    body: bestWaivers,
    theme: 'striped',
    headStyles: { fillColor: [34, 197, 94], fontSize: 8 },
    styles: { fontSize: 7 },
  });

  yPos = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  // Worst Waiver Pickups (with at least 2 games)
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Worst Waiver Pickups (by PAR, min 2 starts)', 14, yPos);
  yPos += 3;

  const worstWaivers = [...waiverPickups]
    .filter(p => p.games >= 2)
    .sort((a, b) => a.par - b.par)
    .slice(0, 10)
    .map((pickup, index) => [
      String(index + 1),
      pickup.playerName,
      pickup.position,
      pickup.teamName.length > 12 ? pickup.teamName.substring(0, 11) + '.' : pickup.teamName,
      `Wk ${pickup.week}`,
      pickup.points.toFixed(0),
      pickup.games > 0 ? (pickup.points / pickup.games).toFixed(1) : '-',
      pickup.par.toFixed(1),
    ]);

  autoTable(doc, {
    startY: yPos,
    head: [['#', 'Player', 'Pos', 'Team', 'Week', 'Pts', 'PPG', 'PAR']],
    body: worstWaivers,
    theme: 'striped',
    headStyles: { fillColor: [239, 68, 68], fontSize: 8 },
    styles: { fontSize: 7 },
  });

  yPos = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  // Overall Waiver Performance
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Overall Waiver Performance', 14, yPos);
  yPos += 3;

  const teamWaiverStats = getTeamWaiverStats(league);
  const waiverData = [...teamWaiverStats].sort((a, b) => b.par - a.par);

  autoTable(doc, {
    startY: yPos,
    head: [['#', 'Team', 'Pickups', 'Points', 'PAR']],
    body: waiverData.map((team, index) => [
      String(index + 1),
      team.name,
      String(team.pickups),
      team.points.toFixed(0),
      team.par >= 0 ? `+${team.par.toFixed(1)}` : team.par.toFixed(1),
    ]),
    theme: 'striped',
    headStyles: { fillColor: [59, 130, 246], fontSize: 8 },
    styles: { fontSize: 7 },
  });

  yPos = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  // ===== PAGE 4: Trades (if any) =====
  if (league.trades && league.trades.length > 0) {
    doc.addPage();
    yPos = 18;

    // Best Trades
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Best Trades (by PAR)', 14, yPos);
    yPos += 3;

    // Flatten all trade sides and sort by net PAR
    const allTradeSides: Array<{
      teamName: string;
      received: string;
      sent: string;
      week: number;
      netPAR: number;
    }> = [];

    league.trades.forEach(trade => {
      trade.teams.forEach(t => {
        allTradeSides.push({
          teamName: t.teamName,
          received: t.playersReceived.map(p => p.name).slice(0, 2).join(', ') +
            (t.playersReceived.length > 2 ? ` +${t.playersReceived.length - 2}` : ''),
          sent: t.playersSent.map(p => p.name).slice(0, 2).join(', ') +
            (t.playersSent.length > 2 ? ` +${t.playersSent.length - 2}` : ''),
          week: trade.week,
          netPAR: t.netPAR ?? t.netValue ?? 0,
        });
      });
    });

    const bestTrades = [...allTradeSides]
      .sort((a, b) => b.netPAR - a.netPAR)
      .slice(0, 10)
      .map((trade, index) => [
        String(index + 1),
        trade.teamName.length > 10 ? trade.teamName.substring(0, 9) + '.' : trade.teamName,
        trade.received.length > 20 ? trade.received.substring(0, 19) + '.' : trade.received,
        trade.sent.length > 20 ? trade.sent.substring(0, 19) + '.' : trade.sent,
        `Wk ${trade.week}`,
        `+${trade.netPAR.toFixed(1)}`,
      ]);

    autoTable(doc, {
      startY: yPos,
      head: [['#', 'Team', 'Received', 'Sent', 'Week', 'PAR']],
      body: bestTrades,
      theme: 'striped',
      headStyles: { fillColor: [34, 197, 94], fontSize: 8 },
      styles: { fontSize: 7 },
    });

    yPos = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

    // Trade Summary by Team
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Trade Performance by Team', 14, yPos);
    yPos += 3;

    const tradeStats = new Map<string, { wins: number; losses: number; fair: number; netPAR: number }>();
    league.teams.forEach(team => {
      tradeStats.set(team.id, { wins: 0, losses: 0, fair: 0, netPAR: 0 });
    });

    league.trades.forEach(trade => {
      trade.teams.forEach(t => {
        const current = tradeStats.get(t.teamId) || { wins: 0, losses: 0, fair: 0, netPAR: 0 };
        if (trade.winner === t.teamId) current.wins++;
        else if (trade.winner) current.losses++;
        else current.fair++;
        current.netPAR += t.netPAR ?? t.netValue ?? 0;
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
      .filter(t => t.wins > 0 || t.losses > 0 || t.fair > 0)
      .sort((a, b) => b.netPAR - a.netPAR);

    autoTable(doc, {
      startY: yPos,
      head: [['#', 'Team', 'Wins', 'Losses', 'Fair', 'Net PAR']],
      body: tradeData.map((team, index) => [
        String(index + 1),
        team.name,
        String(team.wins),
        String(team.losses),
        String(team.fair),
        team.netPAR >= 0 ? `+${team.netPAR.toFixed(1)}` : team.netPAR.toFixed(1),
      ]),
      theme: 'striped',
      headStyles: { fillColor: [139, 92, 246], fontSize: 8 },
      styles: { fontSize: 7 },
    });
  }

  // Footer on all pages
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `Generated by Fantasy Football Analyzer | Page ${i} of ${pageCount}`,
      pageWidth / 2,
      pageHeight - 8,
      { align: 'center' }
    );
  }

  // Save
  doc.save(`${league.name.replace(/[^a-z0-9]/gi, '_')}_${league.season}_Report.pdf`);
}
