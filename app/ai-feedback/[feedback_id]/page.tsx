import { AiFeedbackDetailPage } from "@/components/ai-feedback/AiFeedbackDetailPage";

export const metadata = {
  title: "AI Feedback · Database Agent",
};

export default async function Page({ params }: { params: Promise<{ feedback_id: string }> }) {
  const { feedback_id } = await params;
  return <AiFeedbackDetailPage feedbackId={feedback_id} />;
}
