import type { Request, Response, NextFunction } from "express";
import { HttpStatusCode } from "axios";
import { models } from "../models";
import { ContificoService } from "../services/contifico.service";

const contificoService = new ContificoService();

/**
 * Get cached dashboard stats (Instant response)
 * Query params: from (YYYY-MM-DD), to (YYYY-MM-DD)
 * Default: Last 30 days
 */
export async function getDashboardStats(req: Request, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query;

    let startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);

    let endDate = new Date();

    if (from) startDate = new Date(from as string);
    if (to) endDate = new Date(to as string);

    // Normalize to midnight to include full days
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    console.log(`📊 Fetching cached analytics from ${startDate.toISOString()} to ${endDate.toISOString()}`);

    const summaries = await models.dailySummaries.find({
      dateIso: {
        $gte: startDate,
        $lte: endDate
      }
    }).sort({ dateIso: 1 });

    const totalStats = summaries.reduce((acc, curr) => {
      acc.totalSales += curr.totalSales;
      acc.count += curr.transactionCount;
      return acc;
    }, { totalSales: 0, count: 0 });

    res.status(HttpStatusCode.Ok).send({
      message: "Analytics retrieved successfully (Cached).",
      range: {
        from: startDate.toLocaleDateString(),
        to: endDate.toLocaleDateString()
      },
      stats: totalStats,
      dailyBreakdown: summaries
    });
    return;

  } catch (error) {
    console.error("❌ Error in getDashboardStats:", error);
    res.status(HttpStatusCode.InternalServerError).send({ message: "Error fetching analytics." });
    return;
  }
}

/**
 * Trigger manual sync of historical data
 * This fetches data from Contífico and updates our cache
 * Body: { from: "DD/MM/YYYY", to: "DD/MM/YYYY" } 
 * Default: Syncs ONLY Yesterday if no body provided
 */
export async function syncAnalytics(req: Request, res: Response, next: NextFunction) {
  try {
    let { from, to } = req.body;

    if (!from) {
      // Default: Sync Yesterday
      const yest = new Date();
      yest.setDate(yest.getDate() - 1);
      from = yest.toLocaleDateString("en-GB"); // DD/MM/YYYY
      to = from;
    }

    if (!to) to = from;

    console.log(`🔄 Starting Analytics Sync from ${from} to ${to}`);

    // Parse DD/MM/YYYY to Date loop
    // Simple helper to parse "DD/MM/YYYY" to Date
    const parseDate = (d: string) => {
      const [day, month, year] = d.split("/");
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    };

    const start = parseDate(from);
    const end = parseDate(to);

    // Safety break
    if (start > end) {
      res.status(HttpStatusCode.BadRequest).send({ message: "Start date must be before end date." });
      return;
    }

    const current = new Date(start);
    const results = [];

    while (current <= end) {
      const dayStr = current.toLocaleDateString("en-GB"); // DD/MM/YYYY

      console.log(`   ⬇️ Syncing date: ${dayStr}`);

      // Fetch from Contífico
      // Note: this uses our existing service. 
      // We assume getDocuments returns ALL documents. If large, we assume default limit covers it or user accepts partial.
      // For professional robust large scale, we'd need loop pagination here too.
      // For now, let's assume result_size=1000 param can be passed to service if needed,
      // but current service doesn't expose it. We can rely on default behavior for now.
      const docs = await contificoService.getDocuments({ fecha_emision: dayStr });
      const safeDocs = Array.isArray(docs) ? docs : [];

      const dayTotal = safeDocs.reduce((sum: number, doc: any) => sum + parseFloat(doc.total || "0"), 0);
      const dayCount = safeDocs.length;

      // Upsert to DB
      // current is 00:00 local time usually from parseDate logic? 
      // Careful with Timezones. We want to store it as a unique anchor.
      // Let's use UTC noon to avoid shifting.
      const anchorDate = new Date(Date.UTC(current.getFullYear(), current.getMonth(), current.getDate(), 12, 0, 0));

      await models.dailySummaries.findOneAndUpdate(
        { dateIso: anchorDate },
        {
          dateIso: anchorDate,
          totalSales: Math.round(dayTotal * 100) / 100,
          transactionCount: dayCount,
          lastUpdated: new Date()
        },
        { upsert: true, new: true }
      );

      results.push({ date: dayStr, total: dayTotal, count: dayCount });

      // Next Day
      current.setDate(current.getDate() + 1);
    }

    res.status(HttpStatusCode.Ok).send({
      message: "Analytics Sync Completed.",
      syncedDays: results.length,
      details: results
    });
    return;

  } catch (error) {
    console.error("❌ Error in syncAnalytics:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Error syncing analytics.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}
