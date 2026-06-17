import fs from "node:fs";

const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Bucharest",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
}).formatToParts(new Date());
const value = (type) => parts.find((part) => part.type === type)?.value;
const localDate = `${value("year")}-${value("month")}-${value("day")}`;
const isManual = process.env.GITHUB_EVENT_NAME === "workflow_dispatch";
const shouldRun = isManual || value("hour") === "07";
const lines = [`local_date=${localDate}`, `should_run=${shouldRun}`];

if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
