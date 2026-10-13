import type { FastifyInstance } from "fastify";
import { prisma } from "@tg-cal/db";
import { generateIcsSecret } from "@tg-cal/shared";
import { requireInitData, resolveChatFromStartParam } from "../auth.js";
import { config } from "../config.js";

function icsEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function formatIcsDate(d: Date, allDay: boolean): string {
  if (allDay) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `;VALUE=DATE:${y}${m}${day}`;
  }
  const iso = d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `:${iso}`;
}

export async function icsRoutes(app: FastifyInstance) {
  app.get("/ics/:chatId/:secretToken.ics", async (req, reply) => {
    const { chatId, secretToken } = req.params as {
      chatId: string;
      secretToken: string;
    };

    const chat = await prisma.chat.findUnique({ where: { id: chatId } });
    if (!chat || chat.icsSecret !== secretToken) {
      return reply.code(404).send("Not found");
    }

    const events = await prisma.event.findMany({
      where: { chatId },
      orderBy: { startsAt: "asc" },
    });

    const lines: string[] = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//telegram-calendar//EN",
      "CALSCALE:GREGORIAN",
      `X-WR-CALNAME:${icsEscape(chat.title)}`,
    ];

    for (const e of events) {
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${e.id}@telegram-calendar`);
      lines.push(`DTSTAMP${formatIcsDate(e.updatedAt, false)}`);
      lines.push(`DTSTART${formatIcsDate(e.startsAt, e.allDay)}`);
      if (e.endsAt) {
        lines.push(`DTEND${formatIcsDate(e.endsAt, e.allDay)}`);
      } else if (e.allDay) {
        const end = new Date(e.startsAt);
        end.setUTCDate(end.getUTCDate() + 1);
        lines.push(`DTEND${formatIcsDate(end, true)}`);
      }
      lines.push(`SUMMARY:${icsEscape(e.title)}`);
      if (e.description) {
        lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
      }
      if (e.location) {
        lines.push(`LOCATION:${icsEscape(e.location)}`);
      }
      lines.push("END:VEVENT");
    }

    lines.push("END:VCALENDAR");
    reply
      .header("Content-Type", "text/calendar; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="${chat.title.replace(/[^\w.-]+/g, "_")}.ics"`,
      )
      .send(lines.join("\r\n"));
  });

  app.get(
    "/ics-url",
    {
      preHandler: [requireInitData, resolveChatFromStartParam],
    },
    async (req) => {
      const chat = req.chat!;
      const url = `${config.publicApiUrl()}/ics/${chat.id}/${chat.icsSecret}.ics`;
      return { url };
    },
  );

  app.post(
    "/ics-rotate",
    {
      preHandler: [requireInitData, resolveChatFromStartParam],
    },
    async (req) => {
      const chat = req.chat!;
      const icsSecret = generateIcsSecret();
      await prisma.chat.update({
        where: { id: chat.id },
        data: { icsSecret },
      });
      const url = `${config.publicApiUrl()}/ics/${chat.id}/${icsSecret}.ics`;
      return { url };
    },
  );
}
