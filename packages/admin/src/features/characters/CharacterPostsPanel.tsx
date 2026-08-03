import { Alert, Badge, Loader, Stack, Table, Text } from "@mantine/core";
import { useCursorList } from "../../shared/api/useCursorList";
import { LoadMore } from "../../shared/ui/DataPage";
import { TableText } from "../../shared/ui/TableText";
import { fetchPosts } from "../posts/api";

export function CharacterPostsPanel({ characterId }: { characterId: string }) {
  const posts = useCursorList(["posts", "character", characterId], (cursor) =>
    fetchPosts({ characterId, cursor }),
  );

  if (posts.isPending) {
    return <Loader aria-label="캐릭터 게시글 불러오는 중" />;
  }
  if (posts.error) {
    return (
      <Alert color="red" role="alert" title="게시글을 불러오지 못했습니다">
        {posts.error.message}
      </Alert>
    );
  }
  if (posts.items.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        게시글이 없습니다.
      </Text>
    );
  }

  return (
    <Stack>
      <Table.ScrollContainer minWidth={720}>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>형식</Table.Th>
              <Table.Th>본문</Table.Th>
              <Table.Th>댓글</Table.Th>
              <Table.Th>반응</Table.Th>
              <Table.Th>작성일</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {posts.items.map((post) => (
              <Table.Tr key={post.id}>
                <Table.Td>
                  <Badge variant="light">{post.contentType}</Badge>
                </Table.Td>
                <Table.Td maw={420}>
                  <TableText>{post.content}</TableText>
                </Table.Td>
                <Table.Td>{post.commentCount}</Table.Td>
                <Table.Td>{post.reactionCount}</Table.Td>
                <Table.Td>{formatDateTime(post.createdAt)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <LoadMore
        hasNextPage={posts.hasNextPage}
        isFetching={posts.isFetchingNextPage}
        onLoadMore={() => void posts.fetchNextPage()}
      />
    </Stack>
  );
}

function formatDateTime(value: string) {
  return value.replace("T", " ").slice(0, 16);
}
