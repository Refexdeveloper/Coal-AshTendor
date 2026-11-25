import { useNavigate, useSearchParams } from "react-router-dom";
import { postAction } from "@client/api/client";

/**
 * For settings forms that used to redirect with ?notice= or ?error=: posts the form, then puts the
 * outcome in the page's query string so the banner shows, as before.
 */
export function useNoticeAction(page: string) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const run = (name: string) => async (formData: FormData) => {
    const result = await postAction(name, formData);
    // An import that asks for it opens the new tender, where its documents and the Unfyd extract show.
    if (!result?.error && result?.tenderId && formData.get("openTender") === "1") {
      navigate(`/tenders/${result.tenderId}${result.ok ? `?notice=${encodeURIComponent(result.ok)}` : ""}`);
      return;
    }
    const query = new URLSearchParams();
    if (result?.error) query.set("error", result.error);
    else if (result?.ok) query.set("notice", result.ok);
    navigate(query.size ? `${page}?${query}` : page, { replace: true, preventScrollReset: true });
  };
  return { query: { notice: search.get("notice") ?? undefined, error: search.get("error") ?? undefined }, run };
}
