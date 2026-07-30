import {
  Alert,
  Badge,
  Button,
  Group,
  Loader,
  Stack,
  Table,
  Title,
} from "@mantine/core";
import { useInfiniteQuery } from "@tanstack/react-query";
import { fetchCharacters, type CharacterPage } from "./api";

const STATUS_COLORS: Record<string, string> = {
  active: "green",
  paused: "yellow",
  archived: "gray",
};

export function CharactersPage() {
  const characters = useInfiniteQuery<CharacterPage>({
    queryKey: ["characters"],
    queryFn: ({ pageParam }) =>
      fetchCharacters({ cursor: pageParam as string | undefined }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  if (characters.isPending) {
    return <Loader aria-label="캐릭터를 불러오는 중" />;
  }
  if (characters.isError) {
    return (
      <Alert color="red" role="alert">
        {characters.error.message}
      </Alert>
    );
  }

  const items = characters.data.pages.flatMap((page) => page.items);

  return (
    <Stack>
      <Title order={3}>캐릭터</Title>
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
          {items.map((character) => (
            <Table.Tr key={character.id}>
              <Table.Td>{character.displayName}</Table.Td>
              <Table.Td>{character.publicId}</Table.Td>
              <Table.Td>
                <Badge color={STATUS_COLORS[character.status] ?? "gray"}>
                  {character.status}
                </Badge>
              </Table.Td>
              <Table.Td>{character.postCount}</Table.Td>
              <Table.Td>{character.followerCount}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {characters.hasNextPage ? (
        <Group>
          <Button
            variant="default"
            onClick={() => void characters.fetchNextPage()}
            loading={characters.isFetchingNextPage}
          >
            더 보기
          </Button>
        </Group>
      ) : null}
    </Stack>
  );
}
