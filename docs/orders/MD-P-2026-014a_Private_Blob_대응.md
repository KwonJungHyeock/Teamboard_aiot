# 보강 지시 — MD-P-2026-014 (Private Blob 대응) · 014a
발행 2026-08-05 · MD-P-2026-014 와 함께 적용

## 변경 배경
Blob 스토어를 **Private** 로 생성했다. 내부 개발 과정·설계 이미지가 URL 유출만으로 열람되는 것을
막기 위한 결정이다. 따라서 MD-P-014 의 업로드·표시 방식을 아래로 대체한다.
(공개 저장 전제로 작성된 부분은 이 문서가 우선한다.)

## 전제 확인
- @vercel/blob >= 2.3 필요. 현재 ^2.6.1 설치됨 → 충족.
- 환경변수: BLOB_STORE_ID · VERCEL_OIDC_TOKEN · BLOB_READ_WRITE_TOKEN.
  Vercel 실행 시 **OIDC 우선**(자동 회전). 없으면 작업 중단하고 보고.

## A. 업로드
- put(pathname, file, { access: 'private' }) 로 업로드한다. 공개 URL을 만들지 말 것.
- DB(캔버스 block JSONB 등)에는 **공개 URL이 아니라 pathname 을 저장**한다.
  원본 파일명·크기·contentType 도 함께 저장.
- 경로 규칙: projects/{projectId}/canvas/{uuid}-{원본파일명} 처럼 **추측 불가능한 세그먼트 포함**.

## B. 이미지 전달 경로 (신규)
인증된 사용자에게만 스트리밍하는 라우트를 만든다.
- 경로 예: GET /api/blob?pathname=...
- 순서: **① 라우트 핸들러 안에서 직접 인증 확인** → ② get(pathname, { access: 'private' }) → ③ 스트림 응답
- **미들웨어에 인증을 위임하지 말 것.** 미들웨어 버그가 곧 유출이 된다(공식 문서 경고).
- 권한: 해당 프로젝트·업무에 접근 권한이 있는 사용자만. 없으면 404(존재 여부도 노출 금지).
- 응답 헤더
  - Content-Type: blob 의 contentType
  - X-Content-Type-Options: nosniff
  - Cache-Control: private, no-cache   ← CDN 캐시 금지, 브라우저 재검증 허용
  - ETag: blob.etag
- **조건부 요청 지원**: 요청의 If-None-Match 를 get() 의 ifNoneMatch 로 전달하고,
  statusCode === 304 면 본문 없이 304 응답. (재다운로드 방지)
- s-maxage 등 CDN 캐시 지시자 사용 금지.

## C. 화면 표시
- 캔버스·리뷰·코멘트의 이미지 src 는 **위 라우트 경로**를 가리킨다. blob 원본 URL을 노출하지 말 것.
- 라이트박스·썸네일 모두 동일 경로 사용.
- 로딩 실패 시 깨진 이미지 대신 사유 + [다시 시도].

## D. 삭제
- 블록 삭제 시 pathname 기준으로 blob 삭제(MD-P-014 §C 유지).

## E. 검증 (보고 필수)
1. **로그아웃 상태에서 이미지 라우트 직접 호출 → 401/404** (본문 노출 없음)
2. **권한 없는 계정으로 타 프로젝트 이미지 라우트 호출 → 404**
3. blob 원본 URL(*.private.blob.vercel-storage.com/...)을 브라우저에 직접 붙여넣기 → **열리지 않음**
4. 같은 이미지 재요청 시 **304** 응답 확인(ETag 동작)
5. 블록 삭제 후 blob 객체가 실제로 사라지는지

## 비용 참고
Private 은 Function 을 경유하므로 공개 저장보다 전송 비용이 높다.
100MB 초과 파일은 이 경로로 서빙하지 말 것(업로드 제한 10MB 유지로 충족).
