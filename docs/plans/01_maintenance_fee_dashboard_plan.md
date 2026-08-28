# 관리비 명세서 파싱 및 대시보드 웹 앱 구현 계획서

## 1. 목표
HTML 형식의 관리비 명세서를 파싱하여 데이터를 추출하고, 제니트리 디자인 시스템 v5.0을 적용한 대시보드 웹 앱을 구축합니다. 중복 데이터 방지를 위해 데이터베이스 업서트(Upsert) 로직을 적용합니다.

## 2. 기술 스택 제안
- **프론트엔드**: HTML, CSS, JavaScript (바닐라 JS)
- **백엔드/데이터베이스**: Supabase (규칙에 따라 SQL 쿼리 관리)

## 3. 데이터베이스 (Supabase) 설계
- **테이블명**: `maintenance_fees`
- **주요 컬럼**:
  - `id` (Primary Key, VARCHAR): 청구 연월과 호수를 결합한 고유 식별자 (예: `202603_1403`). 이 필드를 기준으로 중복을 방지(Upsert)합니다.
  - `billing_month` (VARCHAR): 청구 연월
  - `room_number` (VARCHAR): 호수
  - `fee_items` (JSONB): 파싱된 항목명과 금액 데이터 목록
- **마이그레이션**: `001_create_maintenance_fees_table.sql` 파일 생성

## 4. HTML 파싱 로직 가이드
명세서 HTML 파일을 업로드하여 JavaScript로 파싱합니다.
- **연월 추출**: `document.querySelector('.top_left').childNodes[0].textContent` 활용
- **호수 추출**: `document.querySelector('.top_right')`에서 '1403호' 형태의 텍스트 추출
- **항목 추출**: `document.querySelector('.bottom_right')` 내에서 `width:396px` 스타일이 지정된 `div`의 하위 요소(행) 순회. 
  - 항목명: 인덱스 0, 3번째 `span`
  - 금액: 인덱스 1, 4번째 `span`
- **제외 로직**: 항목명이 `&nbsp;`, `공급가액`, `부 가 세`, `과 세 합`, `비과세합`, `기타항목`인 경우 무시.

## 5. UI/UX 구현 (제니트리 디자인 시스템 v5.0)
- **필수 스타일 로드**: `jt-tokens.css` 및 `jt-utilities.css`만 로드 (웹폰트 별도 로드 금지).
- **스타일 규칙**:
  - 색상/크기/간격에 `var(--jt-*)` 토큰 사용 (Hex, RGB, 임의 px, Tailwind 대괄호 사용 엄격히 금지).
  - **버튼**: 기본 주버튼은 먹색(`var(--jt-color-text)` 등, 시스템 디자인 토큰에 따름). 링크나 포커스 시에만 파란색(`var(--jt-color-accent)`).
  - **크기**: 고정 크기(width/height) 대신 최소 크기(min-width, min-height) 사용.
- **테이블 렌더링**:
  ```html
  <div class="jt-table-wrap">
    <table class="jt-table">
      <!-- 내용 -->
      <td class="jt-num">1,000</td>
    </table>
  </div>
  ```
- **상태 알림**: 파일 업로드 및 파싱 완료 후 화면 상단에 "총 O건 업로드 (신규 저장 O건, 중복 업데이트 O건)" 형태의 알림 모달/배너 표시. (크롬 기본 alert 대신 내부 모달 사용)

## 6. 진행 단계 (Step-by-Step)
1. **DB 구축**: Supabase 테이블 및 Upsert 처리용 SQL 작성 및 적용.
2. **UI 뼈대 및 디자인 시스템 적용**: HTML 구조 작성 및 제니트리 v5.0 토큰 연결.
3. **업로드 및 파싱 로직 구현**: HTML 파일 읽기 및 요구사항에 맞춘 데이터 추출.
4. **DB 연동 및 알림 표시**: 파싱된 데이터를 DB에 저장(Upsert)하고 결과 알림 표시.
