import { Badge, Table } from "@mantine/core";
import { useCursorList } from "../../shared/api/useCursorList";
import { DataPage, LoadMore } from "../../shared/ui/DataPage";
import { fetchCharacters, type CharacterStatus } from "./api";

// 색상만으로 상태를 구분하지 않도록 배지에 텍스트를 함께 둔다
// (docs/04-design-rules.md:85).
const STATUS_COLOR: Record<CharacterStatus, string> = {
  active: "teal",
  paused: "attention",
  archived: "gray",
};

export function CharactersPage() {
  const characters = useCursorList(["characters"], (cursor) =>
    fetchCharacters({ cursor }),
  );

  return (
    <DataPage
      title="캐릭터"
      isPending={characters.isPending}
      error={characters.error}
      isEmpty={characters.items.length === 0}
    >
      <Table.ScrollContainer minWidth={640}>
        <Table striped>
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
              <Table.Tr key={character.id}>
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
  );
}
