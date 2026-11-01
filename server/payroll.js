import { createHash } from 'node:crypto';

// Khatyar's organization-export basis: overtime (including exclusive Friday and
// holiday work) + mission - shortage. Surplus is an explicit policy choice.
export function payableWorkMinutes(totals,includeSurplus=false){
  const overtime=totals.total_overtime??((totals.overtime||0)+(totals.friday_work||0)+(totals.holiday_work||0));
  return Math.max(0,overtime+(totals.mission||0)-(totals.shortage||0)+(includeSurplus?(totals.surplus||0):0));
}
export function payrollPreview(snapshot,includeSurplus=false){
  return snapshot.reports.map(entry=>({user_id:entry.id,name:entry.name,
    overtime_minutes:entry.report.totals.total_overtime??0,
    mission_minutes:entry.report.totals.mission||0,
    shortage_minutes:entry.report.totals.shortage||0,
    surplus_minutes:entry.report.totals.surplus||0,
    payable_minutes:payableWorkMinutes(entry.report.totals,includeSurplus)}));
}
export const snapshotDigest=snapshotJson=>createHash('sha256').update(snapshotJson,'utf8').digest('hex');
