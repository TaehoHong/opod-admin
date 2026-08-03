import { Badge, Button, Group, Select, Stack, Table } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCursorList } from "../../shared/api/useCursorList";
import { DataPage, LoadMore } from "../../shared/ui/DataPage";
import { fetchCharacters } from "../characters/api";
import { LocationCreateModal } from "./LocationCreateModal";
import { fetchLocations, type LocationScope } from "./api";

export function LocationsPage() {
  const navigate = useNavigate();
  const [scope, setScope] = useState<LocationScope>("all");
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const characters = useQuery({
    queryKey: ["character-options"],
    queryFn: () => fetchCharacters({ limit: "50" }),
  });
  const locations = useCursorList(["locations", scope, characterId], (cursor) =>
    fetchLocations({
      cursor,
      scope,
      ...(characterId ? { characterId } : {}),
    }),
  );

  return (
    <>
      <DataPage
        title="장소"
        isPending={locations.isPending}
        error={locations.error}
        isEmpty={locations.items.length === 0}
        actions={<Button onClick={() => setCreateOpen(true)}>장소 추가</Button>}
      >
        <Stack>
          <Group align="flex-end">
            <Select
              label="범위"
              value={scope}
              onChange={(value) => setScope((value as LocationScope) ?? "all")}
              data={[
                { value: "all", label: "전체" },
                { value: "global", label: "범용" },
                { value: "character", label: "캐릭터 전용" },
              ]}
            />
            <Select
              label="캐릭터 필터"
              placeholder="전체 캐릭터"
              clearable
              searchable
              value={characterId}
              onChange={setCharacterId}
              data={(characters.data?.items ?? []).map((character) => ({
                value: character.id,
                label: `${character.displayName} (@${character.publicId})`,
              }))}
              disabled={characters.isPending}
            />
          </Group>
          <Table.ScrollContainer minWidth={760}>
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>장소</Table.Th>
                  <Table.Th>키</Table.Th>
                  <Table.Th>범위</Table.Th>
                  <Table.Th>캐릭터</Table.Th>
                  <Table.Th>레퍼런스</Table.Th>
                  <Table.Th>수정일</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {locations.items.map((location) => (
                  <Table.Tr
                    key={location.id}
                    tabIndex={0}
                    aria-label={`${location.displayName} 관리`}
                    onClick={() => navigate(`/locations/${location.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        navigate(`/locations/${location.id}`);
                      }
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <Table.Td>{location.displayName}</Table.Td>
                    <Table.Td>{location.locationKey}</Table.Td>
                    <Table.Td>
                      <Badge color={location.characterId ? "blue" : "gray"}>
                        {location.characterId ? "캐릭터 전용" : "범용"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {location.character?.displayName ?? "—"}
                    </Table.Td>
                    <Table.Td>{location.referenceCount}</Table.Td>
                    <Table.Td>
                      {new Date(location.updatedAt).toLocaleDateString("ko-KR")}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          <LoadMore
            hasNextPage={locations.hasNextPage}
            isFetching={locations.isFetchingNextPage}
            onLoadMore={() => void locations.fetchNextPage()}
          />
        </Stack>
      </DataPage>
      <LocationCreateModal
        opened={createOpen}
        characters={characters.data?.items ?? []}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => navigate(`/locations/${id}`)}
      />
    </>
  );
}
