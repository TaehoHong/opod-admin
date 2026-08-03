import { useNavigate, useParams } from "react-router-dom";

// 목록 화면의 "무엇을 열어 두었는가"를 URL이 소유하게 한다. 운영자는 특정
// 초안·결제·사용자를 두고 대화하므로 주소를 그대로 주고받을 수 있어야 하고,
// 새로고침과 브라우저 뒤로가기가 보던 자리를 지켜야 한다.
export function useDetailSelection(param: string, basePath: string) {
  const params = useParams();
  const navigate = useNavigate();
  const selectedId = params[param] ?? null;

  const select = (id: string | null) => {
    void navigate(id ? `${basePath}/${encodeURIComponent(id)}` : basePath);
  };

  return {
    selectedId,
    select,
    // 같은 항목을 다시 누르면 닫는다 — 목록의 상세/닫기 토글.
    toggle: (id: string) => select(selectedId === id ? null : id),
    close: () => select(null),
  };
}
