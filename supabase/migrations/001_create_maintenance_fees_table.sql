-- 001_create_maintenance_fees_table.sql
-- 관리비 명세서 데이터를 저장하기 위한 테이블 생성 및 업데이트 시간 자동 갱신 설정

CREATE TABLE maintenance_fees (
    id VARCHAR PRIMARY KEY, -- '청구연월_호수' 조합 (예: 202603_1403)을 고유 식별자로 사용하여 중복 방지 (Upsert 용도)
    billing_month VARCHAR NOT NULL, -- 청구 연월 (예: 202603)
    room_number VARCHAR NOT NULL, -- 호수 (예: 1403)
    fee_items JSONB NOT NULL, -- 파싱된 상세 항목명과 금액 데이터를 JSON 형태로 저장
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 데이터가 업데이트(Upsert)될 때 updated_at 시간을 자동으로 갱신하는 함수
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- maintenance_fees 테이블에 업데이트 트리거 적용
CREATE TRIGGER update_maintenance_fees_modtime
BEFORE UPDATE ON maintenance_fees
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();
