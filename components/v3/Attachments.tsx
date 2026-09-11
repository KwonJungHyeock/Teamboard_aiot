"use client";

// v3 「첨부」 — 기록 속 링크를 아래에 다시 보인다 (MD-P-2026-051 §C).
//
// ── 저장하는 것이 없다 ──────────────────────────────────────────
//
// 파일을 올리지 않고 저장소도 안 붙인다. DB·API 도 안 건드린다.
// `task.description` 에 **이미 적혀 있는** URL 을 읽어서 그릴 뿐이고,
// **본문은 그대로 남는다**(뽑아서 지우지 않는다).
//
// ── 빈칸을 두지 않는다 ──────────────────────────────────────────
//
// 그림이 안 뜨면 빈 네모가 남는다. 구글 드라이브가 잠겨 있으면 대부분 여기로
// 오는데, **빈칸은 고장으로 읽힌다.** 그래서 안 뜨면 이유와 「열기」를 낸다.
import { useState } from "react";
import { foldLinks, hasPreview, KIND_LABEL, type LinkItem } from "@/lib/v3/links";

/** 종류를 한 글자로. 아이콘 파일을 새로 들이지 않는다 — 글자가 뜻을 다 말한다. */
const MARK: Record<string, string> = {
  pdf: "PDF", drive: "GD", notion: "N", figma: "Fig", link: "↗", plain: "↗", image: "IMG",
};

/** 새 탭으로 연다. `noreferrer` — 어디서 왔는지 남의 서버에 안 알린다. */
function Open({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <a className="v3-btn v3-btn-s" href={url} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

/**
 * 이미지 한 장. **안 뜨면 이유와 「열기」로 바뀐다.**
 *
 * `referrerpolicy="no-referrer"` — 잠긴 드라이브에 우리 주소를 넘기지 않는다.
 * `loading="lazy"` — 여덟 장이 한꺼번에 붙으면 화면이 느려진다.
 */
function Shot({ item }: { item: LinkItem }) {
  const [bad, setBad] = useState(false);
  if (bad) {
    return (
      <div className="v3-att v3-att-bad">
        <b>미리보기를 못 가져왔습니다</b>
        <span>링크 권한을 확인하세요</span>
        <span className="v3-att-u">{item.label}</span>
        <Open url={item.url}>열기</Open>
      </div>
    );
  }
  return (
    <a className="v3-att v3-att-img" href={item.url} target="_blank" rel="noreferrer noopener"
       title={item.label}>
      <img src={item.url} alt={item.label} loading="lazy" referrerPolicy="no-referrer"
           onError={() => setBad(true)} />
      <span className="v3-att-u">{item.label}</span>
    </a>
  );
}

/** 파일·서비스 카드. 그림을 안 불러오므로 못 가져올 일이 없다 — 늘 「열기」가 있다. */
function CardLink({ item }: { item: LinkItem }) {
  return (
    <div className="v3-att v3-att-file">
      <span className={`v3-att-k k-${item.kind}`}>{MARK[item.kind] ?? "↗"}</span>
      <span className="v3-att-nm">
        <b>{KIND_LABEL[item.kind]}</b>
        <span className="v3-att-u">{item.label}</span>
      </span>
      <Open url={item.url}>열기</Open>
    </div>
  );
}

export default function Attachments({ links }: { links: LinkItem[] }) {
  const [all, setAll] = useState(false);
  if (links.length === 0) return null;
  const { shown, more } = foldLinks(links, all ? links.length : undefined);

  // 칩으로만 서는 것들 — 그냥 링크와 **http**. 미리보기를 만들지 않는다.
  const chips = shown.filter((l) => !hasPreview(l.kind));
  const cards = shown.filter((l) => hasPreview(l.kind));

  return (
    <div className="v3-atts">
      {cards.map((l) => (
        l.kind === "image" ? <Shot key={l.url} item={l} /> : <CardLink key={l.url} item={l} />
      ))}
      {chips.length > 0 && (
        <div className="v3-att-chips">
          {chips.map((l) => (
            <a key={l.url} className={`v3-att-chip${l.secure ? "" : " insecure"}`}
               href={l.url} target="_blank" rel="noreferrer noopener"
               title={l.secure ? l.url : `${l.url} — http 라 미리보기를 만들지 않습니다`}>
              {l.label}
              {/* http 는 **왜 칩뿐인지** 적는다. 조용히 다르게 그리면 고장으로 읽힌다. */}
              {!l.secure && <em>http</em>}
            </a>
          ))}
        </div>
      )}
      {more > 0 && (
        <button type="button" className="v3-btn v3-btn-s v3-att-more" onClick={() => setAll(true)}>
          ＋{more}개 더
        </button>
      )}
    </div>
  );
}
