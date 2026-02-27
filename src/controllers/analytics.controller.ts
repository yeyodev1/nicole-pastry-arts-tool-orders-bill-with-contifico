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

/**
 * Calculate tiered marginal commission
 * Tiers:
 * 0 - 10,000: 0%
 * 10,000 - 13,000: 5%
 * 13,000 - 16,000: 10%
 * 16,000+: 15%
 */
function calculateCommission(sales: number): number {
  let commission = 0;

  if (sales <= 10000) return 0;

  // Tier 1: 10k - 13k (max 3000)
  const t1Sales = Math.min(sales - 10000, 3000);
  commission += t1Sales * 0.05;

  if (sales <= 13000) return commission;

  // Tier 2: 13k - 16k (max 3000)
  const t2Sales = Math.min(sales - 13000, 3000);
  commission += t2Sales * 0.10;

  if (sales <= 16000) return commission;

  // Tier 3: 16k+
  const t3Sales = sales - 16000;
  commission += t3Sales * 0.15;

  return Math.round(commission * 100) / 100;
}

import { AuthRequest } from "../types/AuthRequest";

/**
 * Get sales aggregated by responsible person
 * Query params: from (YYYY-MM-DD), to (YYYY-MM-DD)
 */
export async function getSalesByResponsible(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to } = req.query;

    // --- Enforce Ecuador Time (UTC-5) ---
    // Calculate defaults based on current Ecuador time
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const ecTime = new Date(utc + (3600000 * -5));

    // Default: Start of current month in Ecuador
    let startY = ecTime.getFullYear();
    let startM = ecTime.getMonth() + 1;
    let startD = 1;

    // Default: Today in Ecuador
    let endY = ecTime.getFullYear();
    let endM = ecTime.getMonth() + 1;
    let endD = ecTime.getDate();

    // Parse Input (YYYY-MM-DD)
    if (from && typeof from === 'string') {
      const parts = from.split('-').map(Number);
      if (parts.length === 3) {
        [startY, startM, startD] = parts;
      }
    }
    if (to && typeof to === 'string') {
      const parts = to.split('-').map(Number);
      if (parts.length === 3) {
        [endY, endM, endD] = parts;
      }
    }

    const pad = (n: number) => n.toString().padStart(2, '0');

    // Create Date objects pointing to Ecuador time
    // 00:00:00 Ecuador = 05:00:00 UTC
    const startDate = new Date(`${startY}-${pad(startM)}-${pad(startD)}T00:00:00-05:00`);
    const endDate = new Date(`${endY}-${pad(endM)}-${pad(endD)}T23:59:59.999-05:00`);


    // --- DATA ISOLATION ---
    // Extract user from request (populated by authMiddleware)
    const jwtUser = (req as any).user;

    // Fetch fresh user to avoid stale JWT issues
    let dbUser = jwtUser;
    if (jwtUser?.email) {
      dbUser = await models.users.findOne({ email: jwtUser.email }).lean() || jwtUser;
    }

    const currentRole = dbUser?.role?.toUpperCase();

    const orderMatch: any = {
      createdAt: { $gte: startDate, $lte: endDate },
      invoiceStatus: { $ne: "VOID" } // Ensure we don't count voided orders
    };

    // If SALES_REP, only show their own data
    if (currentRole === 'SALES_REP' || currentRole === 'SALES') {
      // Use case-insensitive regex for Name to catch "diego reyes" vs "Diego Reyes"
      if (dbUser.name) {
        orderMatch.responsible = { $regex: new RegExp(`^${dbUser.name}$`, "i") };
      }
    }

    const stats = await models.orders.aggregate([
      {
        $match: orderMatch
      },
      {
        $group: {
          _id: "$responsible",
          totalSales: { $sum: "$totalValue" },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { totalSales: -1 }
      }
    ]);

    // Map Roles and Commissions
    const enhancedStats = stats.map(s => {
      let role = 'Vendedor';
      const name = s._id ? s._id.toLowerCase() : '';

      if (name.includes('web') || name.includes('online')) {
        role = 'Digital';
      } else if (name.includes('hillary') || name.includes('ivin') || name.includes('e')) {
        role = 'Comercial'; // Known sales reps
      }

      const commission = calculateCommission(s.totalSales);

      return {
        ...s,
        role,
        commission
      };
    });

    // Calculate the number of actual salespeople for the dynamic goal (exclude Digital/Web)
    const activeSalespeopleCount = enhancedStats.filter(s => s.role !== 'Digital').length;

    res.status(HttpStatusCode.Ok).send({
      message: "Sales by responsible retrieved successfully.",
      range: {
        from: startDate.toLocaleDateString("es-EC", { timeZone: "America/Guayaquil" }),
        to: endDate.toLocaleDateString("es-EC", { timeZone: "America/Guayaquil" })
      },
      monthlyGoal: 10000 * Math.max(1, activeSalespeopleCount),
      stats: enhancedStats
    });
    return;
  } catch (error) {
    console.error("❌ Error in getSalesByResponsible:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Error fetching sales stats.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}
