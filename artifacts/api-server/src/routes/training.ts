// ============================================================
// MCC API — Training routes
// GET  /api/training/modules          — list modules + driver progress
// GET  /api/training/modules/:slug    — module with lessons + progress
// GET  /api/training/lessons/:id      — lesson content + questions
// POST /api/training/lessons/:id/complete — submit answers, award cert
// GET  /api/training/certifications   — driver's certifications
// ============================================================

import { Router, type Request, type Response } from "express";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { logger } from "../lib/logger";
import { createDriverNotification } from "./notifications";

const router = Router();

// ── Auth helper ──────────────────────────────────────────────────────────────
async function getDriver(authHeader: string | undefined) {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return null;
  const { data } = await supabaseAdmin
    .from("drivers").select("id").eq("user_id", user.id).single();
  return data as { id: string } | null;
}

// ── GET /api/training/modules ────────────────────────────────────────────────
router.get("/training/modules", async (req: Request, res: Response) => {
  try {
    const driver = await getDriver(req.headers.authorization);
    if (!driver) { res.status(401).json({ error: "Unauthorized" }); return; }

    const [modulesRes, lessonsCountRes, progressRes, certsRes] = await Promise.all([
      supabaseAdmin
        .from("training_modules")
        .select("id, slug, title, description, tier_required, sort_order, estimated_minutes")
        .eq("is_active", true)
        .order("sort_order"),
      supabaseAdmin
        .from("training_lessons")
        .select("module_id, id"),
      supabaseAdmin
        .from("driver_training_progress")
        .select("module_id, lesson_id, status")
        .eq("driver_id", driver.id),
      supabaseAdmin
        .from("driver_certifications")
        .select("module_slug, certified_at")
        .eq("driver_id", driver.id),
    ]);

    type Module = { id: string; slug: string; title: string; description: string; tier_required: number; sort_order: number; estimated_minutes: number };
    type Lesson = { module_id: string; id: string };
    type Progress = { module_id: string; lesson_id: string; status: string };
    type Cert = { module_slug: string; certified_at: string };

    const modules = (modulesRes.data ?? []) as Module[];
    const lessons = (lessonsCountRes.data ?? []) as Lesson[];
    const progress = (progressRes.data ?? []) as Progress[];
    const certs = (certsRes.data ?? []) as Cert[];

    const certSlugs = new Set(certs.map((c) => c.module_slug));

    const result = modules.map((m) => {
      const moduleLessons = lessons.filter((l) => l.module_id === m.id);
      const totalLessons = moduleLessons.length;
      const completedLessons = progress.filter(
        (p) => p.module_id === m.id && p.status === "completed",
      ).length;
      return {
        ...m,
        totalLessons,
        completedLessons,
        percentComplete: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
        isCertified: certSlugs.has(m.slug),
        certifiedAt: certs.find((c) => c.module_slug === m.slug)?.certified_at ?? null,
      };
    });

    res.status(200).json({ modules: result });
  } catch (err) {
    logger.error({ err }, "training.modules unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/training/modules/:slug ──────────────────────────────────────────
router.get("/training/modules/:slug", async (req: Request, res: Response) => {
  try {
    const driver = await getDriver(req.headers.authorization);
    if (!driver) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { slug } = req.params;

    const [moduleRes, progressRes] = await Promise.all([
      supabaseAdmin
        .from("training_modules")
        .select(`
          id, slug, title, description, tier_required, estimated_minutes,
          training_lessons (id, slug, title, content_type, sort_order)
        `)
        .eq("slug", slug)
        .eq("is_active", true)
        .single(),
      supabaseAdmin
        .from("driver_training_progress")
        .select("lesson_id, status, score, completed_at")
        .eq("driver_id", driver.id),
    ]);

    if (!moduleRes.data) { res.status(404).json({ error: "Module not found" }); return; }

    type LessonMeta = { id: string; slug: string; title: string; content_type: string; sort_order: number };
    type ProgressRow = { lesson_id: string; status: string; score: number | null; completed_at: string | null };

    const module = moduleRes.data as { id: string; slug: string; title: string; description: string; tier_required: number; estimated_minutes: number; training_lessons: LessonMeta[] };
    const progress = (progressRes.data ?? []) as ProgressRow[];
    const progressMap = new Map(progress.map((p) => [p.lesson_id, p]));

    const lessons = [...(module.training_lessons ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((l) => {
        const p = progressMap.get(l.id);
        return { ...l, status: p?.status ?? "not_started", score: p?.score ?? null, completedAt: p?.completed_at ?? null };
      });

    const totalLessons = lessons.length;
    const completedLessons = lessons.filter((l) => l.status === "completed").length;

    res.status(200).json({
      module: { ...module, training_lessons: undefined },
      lessons,
      totalLessons,
      completedLessons,
      percentComplete: totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0,
    });
  } catch (err) {
    logger.error({ err }, "training.module.slug unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/training/lessons/:id ────────────────────────────────────────────
router.get("/training/lessons/:id", async (req: Request, res: Response) => {
  try {
    const driver = await getDriver(req.headers.authorization);
    if (!driver) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { id } = req.params;

    const [lessonRes, progressRes] = await Promise.all([
      supabaseAdmin
        .from("training_lessons")
        .select(`
          id, slug, title, content_type, content, sort_order, module_id,
          training_questions (id, question_text, question_type, options, correct_answer, explanation, sort_order)
        `)
        .eq("id", id)
        .single(),
      supabaseAdmin
        .from("driver_training_progress")
        .select("status, score, completed_at")
        .eq("driver_id", driver.id)
        .eq("lesson_id", id)
        .maybeSingle(),
    ]);

    if (!lessonRes.data) { res.status(404).json({ error: "Lesson not found" }); return; }

    type QuestionRow = { id: string; question_text: string; question_type: string; options: unknown; correct_answer: string; explanation: string; sort_order: number };
    const lesson = lessonRes.data as { id: string; slug: string; title: string; content_type: string; content: unknown; sort_order: number; module_id: string; training_questions: QuestionRow[] };
    const questions = [...(lesson.training_questions ?? [])].sort((a, b) => a.sort_order - b.sort_order);

    // Mark started if not already
    if (!progressRes.data || progressRes.data.status === "not_started") {
      await supabaseAdmin.from("driver_training_progress").upsert({
        driver_id: driver.id,
        module_id: lesson.module_id,
        lesson_id: id,
        status: "in_progress",
        started_at: new Date().toISOString(),
      }, { onConflict: "driver_id,lesson_id" });
    }

    res.status(200).json({
      lesson: { ...lesson, training_questions: undefined },
      questions,
      progress: progressRes.data ?? { status: "in_progress", score: null, completedAt: null },
    });
  } catch (err) {
    logger.error({ err }, "training.lesson.id unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── POST /api/training/lessons/:id/complete ───────────────────────────────────
router.post("/training/lessons/:id/complete", async (req: Request, res: Response) => {
  try {
    const driver = await getDriver(req.headers.authorization);
    if (!driver) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { id } = req.params;
    const { answers } = req.body as { answers?: Record<string, string> };
    if (!answers || typeof answers !== "object") {
      res.status(400).json({ error: "answers object is required" }); return;
    }

    // Load lesson + questions + module slug
    const lessonRes = await supabaseAdmin
      .from("training_lessons")
      .select("id, module_id, training_questions (id, correct_answer), training_modules!inner(slug)")
      .eq("id", id)
      .single();

    if (!lessonRes.data) { res.status(404).json({ error: "Lesson not found" }); return; }

    type QuestionRow = { id: string; correct_answer: string };
    type LessonData = { id: string; module_id: string; training_questions: QuestionRow[]; training_modules: { slug: string } };
    const lesson = lessonRes.data as unknown as LessonData;
    const questions = lesson.training_questions ?? [];

    // Score the submission
    const total = questions.length;
    const correct = questions.filter((q) => {
      const submitted = (answers[q.id] ?? "").trim().toLowerCase();
      return submitted === q.correct_answer.trim().toLowerCase();
    }).length;

    const score = total > 0 ? Math.round((correct / total) * 100) : 100;
    const passed = score >= 80;
    const now = new Date().toISOString();

    // Update progress
    await supabaseAdmin.from("driver_training_progress").upsert({
      driver_id: driver.id,
      module_id: lesson.module_id,
      lesson_id: id,
      status: passed ? "completed" : "in_progress",
      score,
      completed_at: passed ? now : null,
    }, { onConflict: "driver_id,lesson_id" });

    // If passed, check if entire module is now complete
    let certified = false;
    if (passed) {
      const [allLessonsRes, completedRes] = await Promise.all([
        supabaseAdmin
          .from("training_lessons")
          .select("id")
          .eq("module_id", lesson.module_id),
        supabaseAdmin
          .from("driver_training_progress")
          .select("lesson_id")
          .eq("driver_id", driver.id)
          .eq("module_id", lesson.module_id)
          .eq("status", "completed"),
      ]);

      const allLessonIds = new Set((allLessonsRes.data ?? []).map((l: { id: string }) => l.id));
      // Include current lesson (just set to completed above)
      const completedIds = new Set((completedRes.data ?? []).map((p: { lesson_id: string }) => p.lesson_id));
      completedIds.add(id);

      const allDone = allLessonIds.size > 0 &&
        [...allLessonIds].every((lid) => completedIds.has(lid));

      if (allDone) {
        const moduleSlug = lesson.training_modules.slug;
        await supabaseAdmin.from("driver_certifications").upsert({
          driver_id: driver.id,
          module_slug: moduleSlug,
          certified_at: now,
        }, { onConflict: "driver_id,module_slug" });

        certified = true;
        void createDriverNotification(
          driver.id,
          "system",
          "🎓 Certification Earned!",
          `You've completed the ${moduleSlug.replace(/-/g, " ")} module and earned your certification.`,
          { moduleSlug },
        );
      }
    }

    res.status(200).json({ score, correct, total, passed, certified });
  } catch (err) {
    logger.error({ err }, "training.lesson.complete unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── GET /api/training/certifications ────────────────────────────────────────
router.get("/training/certifications", async (req: Request, res: Response) => {
  try {
    const driver = await getDriver(req.headers.authorization);
    if (!driver) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { data } = await supabaseAdmin
      .from("driver_certifications")
      .select("id, module_slug, certified_at, expires_at")
      .eq("driver_id", driver.id)
      .order("certified_at", { ascending: false });

    res.status(200).json({ certifications: data ?? [] });
  } catch (err) {
    logger.error({ err }, "training.certifications unhandled error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
