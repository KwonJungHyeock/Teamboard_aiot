/**
 * pg의 timestamptz 텍스트를 브라우저가 확실히 파싱하는 형태로.
 * pg는 "2026-08-04 05:44:12.34+00"처럼 오프셋의 분(minute)을 생략해서 내보내는데,
 * Safari 등 일부 엔진은 이걸 Invalid Date로 처리한다.
 */
export function pgDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  let s = iso.replace(" ", "T");
  if (/[+-]\d{2}$/.test(s)) s += ":00";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
