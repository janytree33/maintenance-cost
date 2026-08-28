export async function onRequestPost(context) {
    try {
        const { request, env } = context;
        
        // 1. 클라우드플레어 환경 변수에서 제미나이 API 키 가져오기
        const apiKey = env.GEMINI_API_KEY;
        if (!apiKey) {
            return new Response(JSON.stringify({ error: "서버에 제미나이 API 키가 설정되지 않았습니다. 클라우드플레어 환경 변수를 확인해 주세요." }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }

        // 2. 프론트엔드에서 보낸 데이터(JSON) 읽기
        const body = await request.json();
        const { prompt, context: anomalyContext } = body;

        if (!prompt) {
            return new Response(JSON.stringify({ error: "질문 내용이 없습니다." }), {
                status: 400,
                headers: { "Content-Type": "application/json" }
            });
        }

        // 3. 제미나이(Gemini 1.5 Flash) API 호출 준비
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        
        // AI에게 역할을 부여하는 프롬프트
        const systemPrompt = "당신은 관리비 이상 내역을 친절하게 분석해 주는 똑똑한 AI 비서 '제니'입니다. 전문 용어를 피하고 일반인이 이해하기 쉽게 아주 친절하고 부드러운 말투로 답변해 주세요. 대답할 때 제공된 [현재 화면의 이상 감지 내역] 데이터를 적극적으로 참고해서 구체적인 금액과 항목을 언급해 주면 좋습니다.";
        
        const fullPrompt = `${systemPrompt}\n\n[현재 화면의 이상 감지 내역]\n${anomalyContext || '표시된 내역 없음'}\n\n[사용자 질문]\n${prompt}`;

        const geminiRequestBody = {
            contents: [{
                role: "user",
                parts: [{ text: fullPrompt }]
            }]
        };

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(geminiRequestBody)
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("Gemini API Error:", data);
            return new Response(JSON.stringify({ error: "AI API 호출 중 문제가 발생했습니다." }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }

        // 4. 제미나이 응답에서 텍스트 추출
        const answerText = data.candidates?.[0]?.content?.parts?.[0]?.text || "답변을 생성할 수 없습니다.";

        return new Response(JSON.stringify({ answer: answerText }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: `서버 오류: ${error.message}` }), {
            status: 500,
            headers: { "Content-Type": "application/json" }
        });
    }
}
