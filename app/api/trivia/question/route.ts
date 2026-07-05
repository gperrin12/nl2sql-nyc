import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthenticated } from "@/lib/auth";
import { generateVerifiedTriviaQuestion } from "@/lib/trivia-generate-verified";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BodySchema = z.object({
  deck: z.enum(["mta", "311", "grab-bag"]).optional(),
  categoryId: z.string().optional(),
  excludeQuestions: z.array(z.string()).optional(),
  usedFamilies: z.array(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let sessionBody: z.infer<typeof BodySchema> = {};
  try {
    const raw = await req.json();
    sessionBody = BodySchema.parse(raw);
  } catch {
    sessionBody = {};
  }

  const result = await generateVerifiedTriviaQuestion({
    ...sessionBody,
    mode: "solo",
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail, sql: result.sql },
      { status: 502 }
    );
  }

  return NextResponse.json(result.question);
}
