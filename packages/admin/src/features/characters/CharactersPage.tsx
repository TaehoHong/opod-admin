import { Badge, Button, Table } from "@mantine/core";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCursorList } from "../../shared/api/useCursorList";
import { DataPage, LoadMore } from "../../shared/ui/DataPage";
import { CharacterCreateModal } from "./CharacterCreateModal";
import { fetchCharacters, type CharacterStatus } from "./api";

// 색상만으로 상태를 구분하지 않도록 배지에 텍스트를 함께 둔다
// (docs/04-design-rules.md:85).
const STATUS_COLOR: Record<CharacterStatus, string> = {
  active: "teal",
  inactive: "gray",
};

export function CharactersPage() {
  const [createOpen, setCreateOpen] = useState(false);
  const navigate = useNavigate();
  const characters = useCursorList(["characters"], (cursor) =>
    fetchCharacters({ cursor }),
  );

  return (
    <>
      <DataPage
        title="캐릭터"
        isPending={characters.isPending}
        error={characters.error}
        isEmpty={characters.items.length === 0}
        actions={
          <Button onClick={() => setCreateOpen(true)}>캐릭터 추가</Button>
        }
      >
        <Table.ScrollContainer minWidth={640}>
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>이름</Table.Th>
                <Table.Th>핸들</Table.Th>
                <Table.Th>상태</Table.Th>
                <Table.Th>게시글</Table.Th>
                <Table.Th>팔로워</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {characters.items.map((character) => (
                <Table.Tr
                  key={character.id}
                  tabIndex={0}
                  aria-label={`${character.displayName} 관리`}
                  onClick={() => navigate(`/characters/${character.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigate(`/characters/${character.id}`);
                    }
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <Table.Td>{character.displayName}</Table.Td>
                  <Table.Td>{character.publicId}</Table.Td>
                  <Table.Td>
                    <Badge color={STATUS_COLOR[character.status] ?? "gray"}>
                      {character.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{character.postCount}</Table.Td>
                  <Table.Td>{character.followerCount}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <LoadMore
          hasNextPage={characters.hasNextPage}
          isFetching={characters.isFetchingNextPage}
          onLoadMore={() => void characters.fetchNextPage()}
        />
      </DataPage>
      <CharacterCreateModal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(characterId) => navigate(`/characters/${characterId}`)}
      />
    </>
  );
}
