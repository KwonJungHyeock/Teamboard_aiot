// 영역 상세 (B-11 재생성 · MD-P-2026-031 §C4).
//
// ── 이 파일이 리다이렉트였다 ──────────────────────────────────────
//
// MD-P-2026-027 §B2 에서 영역을 사이드바에서 필터로 내리면서 `/areas/{id}` 를
// `/tasks?area={id}` 로 보냈고, 그 결과 영역 화면이 **도달 불가**가 됐다(B-11).
// 여기서 되살린다. **리다이렉트를 걷어내는 것과 화면을 만드는 것이 한 커밋이다** —
// 나누면 그 사이에 404 가 생긴다(§C 회신 3).
//
// ── 옛 구현을 살리는 것이 아니다 ─────────────────────────────────
//
// 옛 `AreaView` 는 업무·프로젝트·목표·자료를 탭으로 묶은 화면이었다. 그건 지웠고,
// 탭 자체가 이제 규칙 위반이다(「탭을 두면 첫 것만 눌린다」).
//
// 대신 **`TasksView` 를 영역 고정 모드로 연다.** 새 목록을 만들지 않는다 —
// 필터·정렬·묶기·기한 막대·빈 상태가 두 벌이 되면 그게 §C4 가 막으려는 바로 그것이다.
//
// > **홈에만 만들고 나머지를 옛 목록으로 두면 이 작업은 실패다.**
//
// 그래서 이 화면은 `TaskTable` 을 쓰는 **네 번째 자리**이고,
// `scripts/component-reuse-audit.mjs` 가 그 사실을 증명한다.
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { userDefaults } from "@/lib/user-defaults";
import { queryOne } from "@/lib/db";
import AppShell from "@/components/AppShell";
import TasksView from "@/components/TasksView";

export const dynamic = "force-dynamic";

export default async function AreaPage({ params, searchParams }: {
  params: { key: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const user = getSession();
  if (!user) redirect("/login");

  const id = Number(params.key);
  if (!Number.isInteger(id) || id <= 0) notFound();
  // workspace 영역만 작업 공간을 가졌다. link_only·비활성은 예전처럼 404 (파트 0) —
  // **없는 것을 있는 것처럼 보여주지 않는다.**
  const area = await queryOne<{ id: number; name: string; color_key: string | null }>(
    `SELECT id, name, color_key FROM area WHERE id = $1 AND is_active = true AND kind = 'workspace'`,
    [id]
  );
  if (!area) notFound();

  const defaults = await userDefaults(user);
  const q = (k: string) => {
    const v = searchParams?.[k];
    return typeof v === "string" && v !== "" ? v : undefined;
  };

  return (
    <AppShell user={user}>
      <TasksView
        user={user}
        defaults={defaults}
        // 영역은 주소(`/areas/3`)가 정한다. `?area=` 는 읽지 않는다 —
        // 두 곳에서 정하면 둘이 어긋났을 때 어느 쪽이 맞는지 알 수 없다.
        initialAreas={[area.id]}
        lockedArea={{ id: area.id, name: area.name, colorKey: area.color_key }}
        /*
         * 담당은 `/tasks` 와 **같은 규칙**이다 — 주소에 있으면 그것, 없으면 내 기본값.
         *
         * 처음엔 영역 화면을 팀 전체로 열려고 `assignee: "all"` 을 박았다. 틀렸다.
         * `assignee` 는 저장값을 안 보는 키라 마운트 때 **주소만** 다시 읽는다.
         * 주소에 없는 값을 `initial` 로 주면 서버는 「전체 담당」을 그리고 클라이언트는
         * 곧바로 「나」로 돌아간다 — `listquery-walk` 가 잡아내는 그 하이드레이션 어긋남이다.
         *
         * 팀 전체로 열고 싶으면 **주소에 적는다**(`/areas/3?assignee=all`).
         * 화면이 몰래 정하지 않는다.
         */
        initial={{
          sort: q("sort"), group: q("group"), done: q("done"), assignee: q("assignee"),
        }}
      />
    </AppShell>
  );
}
