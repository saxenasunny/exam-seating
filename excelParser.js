/**
 * Excel Parser for Exam Seating Plans
 *
 * Expected Excel Format (based on template analysis):
 * - Sheet name = Room Number (e.g., B007, B013)
 * - Row 1: Exam title
 * - Row 2: Date and session
 * - Row 3: Room label
 * - Row 4: Course info
 * - Row 5: Total count label
 * - Row 6 (index 5): Column headers = Row labels (ROW1, ROW3, etc.)
 * - Row 7 (index 6): Course names per row
 * - Rows 8-13+ (index 7+): Enrollment numbers in grid
 * - Summary sheets are automatically skipped
 */

const XLSX = require('xlsx');

// Patterns to identify summary/metadata sheets to skip
const SUMMARY_SHEET_PATTERNS = [
  /summary/i,
  /capacity/i,
  /total/i,
  /index/i,
  /master/i,
  /overview/i,
];

/**
 * Check if a sheet name is a summary/non-room sheet
 */
function isSummarySheet(sheetName) {
  return SUMMARY_SHEET_PATTERNS.some((pattern) => pattern.test(sheetName));
}

/**
 * Parse a single room sheet and extract seating records
 * @param {Object} worksheet - XLSX worksheet object
 * @param {string} sheetName - Name of the sheet (= Room Number)
 * @returns {Array} Array of seating record objects
 */
function parseRoomSheet(worksheet, sheetName) {
  const records = [];

  // Convert sheet to 2D array (header: false = raw mode, no auto-header)
  const data = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,         // Return array of arrays
    defval: null,      // Use null for empty cells
    raw: true,         // Keep raw values (numbers stay numbers)
  });

  if (!data || data.length < 8) return records; // Not enough rows

  // Row 6 (index 5) contains row labels: ROW1, ROW3, ROW4, etc.
  const rowHeaders = data[5] || [];

  // Find the last column with data in row headers
  const columnCount = rowHeaders.filter(v => v !== null && v !== undefined).length;

  if (columnCount === 0) return records;

  // Data rows start at index 7 (row 8 in Excel)
  // Data rows end before the COUNT formula rows
  // We detect data rows by checking if cell is a number (enrollment number)
  for (let rowIdx = 7; rowIdx < data.length; rowIdx++) {
    const row = data[rowIdx];
    if (!row) continue;

    let hasData = false;

    for (let colIdx = 0; colIdx < columnCount; colIdx++) {
      const cellValue = row[colIdx];

      // Skip null/undefined/formula cells
      if (cellValue === null || cellValue === undefined) continue;
      if (typeof cellValue === 'string' && cellValue.startsWith('=')) continue;

      // Check if it looks like an enrollment number (numeric, ~12 digits)
      const enrollment = String(cellValue).trim();
      if (!enrollment || enrollment.length < 6) continue;

      // Verify it's numeric (enrollment numbers are purely numeric)
      if (!/^\d+$/.test(enrollment)) continue;

      const rowLabel = rowHeaders[colIdx]
        ? String(rowHeaders[colIdx]).trim()
        : `COL${colIdx + 1}`;

      // Seat number = position within the column (1-indexed from data start row)
      const seatNumber = rowIdx - 6; // seat position within the row

      records.push({
        enrollment,
        room_number: sheetName,
        row_number: rowLabel,
        seat_number: seatNumber,
        sheet_name: sheetName,
      });

      hasData = true;
    }

    // Stop if we hit a row with no valid enrollment numbers
    // (likely count/formula rows at the bottom)
    if (!hasData && rowIdx > 8) {
      // Check if next 2 rows also have no data — then stop
      const nextRow = data[rowIdx + 1] || [];
      const hasNextData = nextRow.some(v => v && /^\d{6,}$/.test(String(v)));
      if (!hasNextData) break;
    }
  }

  return records;
}

/**
 * Parse an entire Excel workbook and extract all seating records
 * @param {string} filePath - Path to the Excel file
 * @returns {Object} { records: Array, stats: Object, errors: Array }
 */
function parseSeatingPlan(filePath) {
  const workbook = XLSX.readFile(filePath, {
    cellFormula: false,  // Don't parse formulas
    cellHTML: false,
    cellText: false,
    raw: true,
  });

  const allRecords = [];
  const roomStats = {};
  const errors = [];
  const skippedSheets = [];
  const processedSheets = [];

  for (const sheetName of workbook.SheetNames) {
    // Skip summary/metadata sheets
    if (isSummarySheet(sheetName)) {
      skippedSheets.push(sheetName);
      continue;
    }

    try {
      const worksheet = workbook.Sheets[sheetName];
      const records = parseRoomSheet(worksheet, sheetName);

      if (records.length === 0) {
        skippedSheets.push(`${sheetName} (empty)`);
        continue;
      }

      allRecords.push(...records);
      roomStats[sheetName] = records.length;
      processedSheets.push(sheetName);

    } catch (err) {
      errors.push({ sheet: sheetName, error: err.message });
    }
  }

  // Detect duplicate enrollments within this file
  const enrollmentMap = {};
  const duplicates = [];

  for (const record of allRecords) {
    if (enrollmentMap[record.enrollment]) {
      duplicates.push({
        enrollment: record.enrollment,
        rooms: [enrollmentMap[record.enrollment].room_number, record.room_number],
      });
    } else {
      enrollmentMap[record.enrollment] = record;
    }
  }

  return {
    records: allRecords,
    stats: {
      totalStudents: allRecords.length,
      totalRooms: processedSheets.length,
      roomBreakdown: roomStats,
      processedSheets,
      skippedSheets,
      duplicates,
    },
    errors,
  };
}

module.exports = { parseSeatingPlan, isSummarySheet };
