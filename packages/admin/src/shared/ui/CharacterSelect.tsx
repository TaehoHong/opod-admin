import { Select, type SelectProps } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "../api/apiClient";
import type { CursorPage } from "../api/useCursorList";

// 초안과 생성 화면이 같은 캐릭터 선택을 쓴다. raw ID 대신 이름을 고르게 한다
// (docs/04-design-rules.md:12).

const OPTION_LIMIT = 100;

type CharacterOption = {
  id: string;
  publicId: string;
  displayName: string;
};

export function useCharacterOptions() {
  return useQuery({
    queryKey: ["character-options"],
    queryFn: () =>
      apiRequest<CursorPage<CharacterOption>>(
        `/characters?limit=${OPTION_LIMIT}`,
      ),
    staleTime: 5 * 60 * 1000,
  });
}

export function CharacterSelect(
  props: Omit<SelectProps, "data"> & { label?: string },
) {
  const characters = useCharacterOptions();
  const data = (characters.data?.items ?? []).map((character) => ({
    value: character.id,
    label: character.displayName || character.publicId || character.id,
  }));

  return (
    <Select
      label={props.label ?? "캐릭터"}
      placeholder={characters.isPending ? "불러오는 중…" : "선택하세요"}
      data={data}
      searchable
      disabled={characters.isPending}
      {...props}
    />
  );
}
