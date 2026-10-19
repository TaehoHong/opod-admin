import {
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useCursorList } from "../../shared/api/useCursorList";
import { previewUrl } from "../../shared/media/previewUrl";
import { DataPage, LoadMore } from "../../shared/ui/DataPage";
import {
  OperationErrorAlert,
  operationFailure,
} from "../../shared/ui/OperationErrorAlert";
import {
  fetchCharacterReferenceLinks,
  fetchCharacters,
  type CharacterListItem,
} from "./api";
import classes from "./CharacterSnsPage.module.css";

export function CharacterSnsPage() {
  const characters = useCursorList(["characters"], (cursor) =>
    fetchCharacters({ cursor }),
  );

  return (
    <DataPage
      title="SNS 레퍼런스"
      isPending={characters.isPending}
      error={characters.error}
      isEmpty={characters.items.length === 0}
      emptyLabel="등록된 캐릭터가 없습니다."
      actions={
        characters.error ? (
          <Button variant="default" onClick={() => void characters.refetch()}>
            캐릭터 목록 다시 시도
          </Button>
        ) : null
      }
    >
      <Text c="ink.6">
        캐릭터별 모티브·참조 SNS를 확인하고 새 탭에서 열 수 있습니다.
      </Text>
      <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }} spacing="lg">
        {characters.items.map((character) => (
          <CharacterSnsCard key={character.id} character={character} />
        ))}
      </SimpleGrid>
      <LoadMore
        hasNextPage={characters.hasNextPage}
        isFetching={characters.isFetchingNextPage}
        onLoadMore={() => void characters.fetchNextPage()}
      />
    </DataPage>
  );
}

function CharacterSnsCard({ character }: { character: CharacterListItem }) {
  const links = useQuery({
    queryKey: ["character", character.id, "reference-links"],
    queryFn: () => fetchCharacterReferenceLinks(character.id),
  });

  return (
    <Paper
      component="section"
      aria-label={`${character.displayName} SNS`}
      p="lg"
    >
      <Stack gap="lg">
        <Group justify="space-between" align="flex-start">
          <Stack gap={2} className={classes.identity}>
            <Title order={2} size="h4">
              {character.displayName}
            </Title>
            <Text size="sm" c="ink.6" className={classes.url}>
              @{character.publicId}
            </Text>
          </Stack>
          <Button
            component={Link}
            to={`/characters/${encodeURIComponent(character.id)}?section=profile`}
            variant="default"
            size="sm"
            aria-label={`${character.displayName} 링크 관리`}
          >
            링크 관리
          </Button>
        </Group>
        {links.isPending ? (
          <Group role="status" gap="xs">
            <Loader size="sm" aria-hidden />
            <Text size="sm" c="ink.6">
              참조 링크 불러오는 중…
            </Text>
          </Group>
        ) : null}
        {links.error ? (
          <Stack gap="sm">
            <OperationErrorAlert
              failure={operationFailure(
                links.error,
                "참조 링크를 불러오지 못했습니다.",
              )}
            />
            <Button
              variant="default"
              loading={links.isFetching}
              onClick={() => void links.refetch()}
            >
              다시 시도
            </Button>
          </Stack>
        ) : null}
        {links.isSuccess ? (
          <Stack gap="xs">
            <Badge variant="light" color={links.data.length ? "teal" : "gray"}>
              {links.data.length ? `${links.data.length}개 등록` : "미등록"}
            </Badge>
            {links.data.length === 0 ? (
              <Text size="sm" c="ink.6">
                등록된 참조 SNS가 없습니다. 링크 관리에서 추가해 주세요.
              </Text>
            ) : null}
            {links.data.map((link) => {
              const href = previewUrl(link.url);
              return href ? (
                <Anchor
                  key={link.id}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  c="ink.8"
                  size="sm"
                  py="sm"
                  className={classes.link}
                  aria-label={`${character.displayName} 참조 SNS ${link.url} 새 탭에서 열기`}
                >
                  <span className={classes.url}>{link.url}</span>
                  <ArrowSquareOut
                    size={16}
                    aria-hidden
                    className={classes.icon}
                  />
                </Anchor>
              ) : (
                <Text key={link.id} size="sm" className={classes.url}>
                  {link.url}
                </Text>
              );
            })}
          </Stack>
        ) : null}
      </Stack>
    </Paper>
  );
}
