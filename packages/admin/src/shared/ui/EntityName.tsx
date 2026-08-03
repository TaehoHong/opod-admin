import { Text, type TextProps } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../api/apiClient";
import type { CursorPage } from "../api/useCursorList";
import { useCharacterOptions } from "./CharacterSelect";

// 목록은 캐릭터·사용자를 ID로 참조하지만 운영자가 읽는 것은 이름이다. raw ID는
// 기본 화면에 노출하지 않는다 (docs/04-design-rules.md:12).
//
// 이름은 한 번 받아 캐시한 목록에서 찾는다. 행마다 단건 조회를 하면 목록 크기만큼
// 요청이 늘어난다. 목록 밖의 ID는 앞 8자만 보여 주고 전체 ID는 title에 남긴다 —
// 화면은 짧게 두되 필요할 때 확인은 되어야 한다.

const LOOKUP_LIMIT = 100;
const LOOKUP_STALE_MS = 5 * 60 * 1000;

type UserLabelItem = { id: string; displayName: string; email?: string };

function useUserLabels() {
  return useQuery({
    queryKey: ["user-labels"],
    queryFn: () =>
      apiRequest<CursorPage<UserLabelItem>>(`/users?limit=${LOOKUP_LIMIT}`),
    staleTime: LOOKUP_STALE_MS,
  });
}

export function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function EntityLabel({
  id,
  name,
  ...textProps
}: { id?: string; name?: string } & TextProps) {
  if (!id) {
    return (
      <Text c="dimmed" {...textProps}>
        —
      </Text>
    );
  }
  return name ? (
    <Text {...textProps}>{name}</Text>
  ) : (
    <Text c="dimmed" title={id} {...textProps}>
      {shortId(id)}
    </Text>
  );
}

export function CharacterName({
  id,
  ...textProps
}: { id?: string } & TextProps) {
  const characters = useCharacterOptions();
  const match = characters.data?.items.find((item) => item.id === id);
  const name = match?.displayName || match?.publicId;
  return <EntityLabel id={id} {...(name ? { name } : {})} {...textProps} />;
}

export function UserName({ id, ...textProps }: { id?: string } & TextProps) {
  const users = useUserLabels();
  const match = users.data?.items.find((item) => item.id === id);
  const name = match?.email || match?.displayName;
  return <EntityLabel id={id} {...(name ? { name } : {})} {...textProps} />;
}
