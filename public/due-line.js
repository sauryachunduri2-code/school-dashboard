/*
 * The "Due ..." line of a task reminder, worded in the device's own timezone and relative to when it is shown:
 * "Due today", "Due tomorrow", "Due Fri", "Due 4:00 PM", "Due tomorrow 4:00 PM", "Due Fri 4:00 PM".
 * Loaded by sw.js with importScripts; tests/due-line.test.ts loads the same file.
 */
(function (root) {
  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function dueLine(data, now, locale) {
    if (!data || !data.due_at) return "";
    var due = new Date(data.due_at);
    if (isNaN(+due)) return "";
    var ref = now || new Date();
    // calendar days apart (rounded, so the odd 23/25 hour DST day doesn't matter)
    var diff = Math.round((+startOfDay(due) - +startOfDay(ref)) / 86400000);
    var day = "";
    if (diff === 1) day = "tomorrow";
    else if (diff === -1) day = "yesterday";
    else if (diff > 1 && diff < 7) day = due.toLocaleDateString(locale, { weekday: "short" });
    else if (diff !== 0) day = due.toLocaleDateString(locale, { month: "short", day: "numeric" });

    if (data.all_day) return "Due " + (day || "today");
    var time = due.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
    return "Due " + (day ? day + " " : "") + time;
  }

  root.dueLine = dueLine;
})(typeof self !== "undefined" ? self : globalThis);
