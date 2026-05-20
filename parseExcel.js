/**
 * Excel Parser for Exam Seating Plans
 *
 * Excel Structure (based on uploaded template):
 *   - Sheet 0: Summary sheet (skip if name contains "summary")
 *   - Each subsequent sheet: Room number (e.g., B007, B013)
 *     Row 0-4 : Header info (title, date, room number, courses, totals)
 *     Row 5   : Column labels → ROW1, ROW3, ROW4, ROW6 ... (room row numbers)
 *     Row 6   : Course names per column
 *     Row 7+  : Enrollment numbers (6 per column in the template)
 *     Last 2  : Count rows (skip — small integers like 6, 72)
 */

const XLSX = require('xlsx');

function parseExcelFile(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false, raw: true });
  const records = [];
  const skippedSheets = [];

  for (const sheetName of workbook.SheetNames) {
    // Skip summary / overview sheets
    if (/summary|capacity|overview|index/i.test(sheetName)) {
      skippedSheets.push(sheetName);
      continue;
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
      blankrows: true
    });

    // Find the row that contains "ROW" labels (column headers)
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const row = rows[i];
      if (!row) continue;
      const hasRowLabel = row.some(
        (cell) => cell && typeof cell === 'string' && /^ROW\d+$/i.test(String(cell).trim())
      );
      if (hasRowLabel) { headerRowIdx = i; break; }
    }

    if (headerRowIdx === -1) {
      skippedSheets.push(sheetName + ' (no ROW headers found)');
      continue;
    }

    // Build column → row_label map
    const headerRow = rows[headerRowIdx];
    const colToRowLabel = {};
    headerRow.forEach((cell, colIdx) => {
      if (cell && /^ROW\d+$/i.test(String(cell).trim())) {
        colToRowLabel[colIdx] = String(cell).trim();
      }
    });

    // Data rows start 2 after header row (skip the course-name row)
    const dataStartIdx = headerRowIdx + 2;

    // For each data column, extract enrollment numbers
    for (const [colIdxStr, rowLabel] of Object.entries(colToRowLabel)) {
      const colIdx = parseInt(colIdxStr);
      let seatNum = 1;

      for (let rowIdx = dataStartIdx; rowIdx < rows.length; rowIdx++) {
        const row = rows[rowIdx];
        if (!row) continue;

        const cell = row[colIdx];
        if (cell === null || cell === undefined) continue;

        const cellStr = String(cell).trim();
        if (!cellStr) continue;

        // Skip count/summary cells: short numbers (< 5 chars, all digits)
        if (/^\d{1,4}\.?0*$/.test(cellStr)) continue;

        // Valid enrollment: typically 12-15 digit numeric strings
        // or alphanumeric IDs; must be at least 6 chars
        if (cellStr.length >= 6) {
          records.push({
            enrollment: cellStr,
            room_number: sheetName.trim(),
            row_number: rowLabel,
            seat_number: seatNum,
            sheet_name: sheetName.trim()
          });
          seatNum++;
        }
      }
    }
  }

  return { records, skippedSheets };
}

module.exports = { parseExcelFile };
