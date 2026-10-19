import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Image,
  Paper,
  Select,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import {
  ArrowClockwise,
  ArrowSquareOut,
  CaretRight,
  ImageSquare,
  MagnifyingGlass,
  Plus,
  UploadSimple,
  VideoCamera,
} from "@phosphor-icons/react";
import { useDebouncedValue } from "@mantine/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useCursorList } from "../../shared/api/useCursorList";
import { DataPage, LoadMore } from "../../shared/ui/DataPage";
import { previewUrl } from "../../shared/media/previewUrl";
import {
  fetchLibraryMedia,
  searchInfluencers,
  type Influencer,
  type InfluencerMedia,
} from "./api";
import { LibraryPicker } from "./LibraryPicker";
import { accountOptions, characterOptions } from "./library-options";
import { MediaDetailModal, assetLabel } from "./InfluencerMediaModal";
import { MediaUploadModal } from "./MediaUploadModal";
import { AccountModal } from "./AccountModal";
import classes from "./ReferenceLibrary.module.css";

export function InfluencerLibraryPage() {
  const [params, setParams] = useSearchParams();
  const accountId = params.get("account") ?? "";
  const characterId = params.get("character") ?? "";
  const view = params.get("view") === "accounts" ? "accounts" : "media";
  const search = params.get("search") ?? "";
  const [debounced] = useDebouncedValue(search, 300);
  const assetType = params.get("type") ?? "";
  const analysisStatus = params.get("analysis") ?? "";
  const media = useCursorList(
    [
      "influencer-media",
      characterId,
      accountId,
      debounced,
      assetType,
      analysisStatus,
      "newest",
    ],
    (cursor) =>
      fetchLibraryMedia(
        {
          characterId,
          influencerId: accountId,
          search: debounced,
          assetType,
          analysisStatus,
        },
        cursor,
      ),
  );
  const [accountSearch, setAccountSearch] = useState("");
  const [accountDebounced] = useDebouncedValue(accountSearch, 250);
  const accounts = useCursorList(
    ["influencers", accountDebounced, characterId],
    (cursor) => searchInfluencers(accountDebounced, cursor, characterId),
  );
  const [selected, setSelected] = useState<InfluencerMedia | null>(null);
  const [uploading, setUploading] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);
  const queryClient = useQueryClient();
  const filter = (updates: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next);
  };
  const accountValue = accountId
    ? { value: accountId, label: params.get("accountName") || "선택한 계정" }
    : null;
  const refresh = () => {
    void media.refetch();
    void accounts.refetch();
  };
  const registered = () => {
    void queryClient.invalidateQueries({ queryKey: ["influencer-media"] });
  };
  const filters = (
    <div className={classes.filters}>
      <div className={classes.picker}>
        <LibraryPicker
          label="캐릭터"
          value={
            characterId
              ? {
                  value: characterId,
                  label: params.get("characterName") || "선택한 캐릭터",
                }
              : null
          }
          queryKey={["library-character-options"]}
          fetchOptions={characterOptions}
          onChange={(value) =>
            filter({
              character: value?.value ?? "",
              characterName: value?.label ?? "",
              account: "",
              accountName: "",
            })
          }
        />
      </div>
      <div className={classes.picker}>
        <LibraryPicker
          key={characterId}
          label="SNS 계정"
          value={accountValue}
          queryKey={["library-account-options", characterId]}
          fetchOptions={(term, cursor) =>
            accountOptions(term, cursor, characterId)
          }
          onChange={(value) =>
            filter({
              account: value?.value ?? "",
              accountName: value?.label ?? "",
            })
          }
        />
      </div>
      <TextInput
        className={classes.search}
        label="미디어 검색"
        placeholder="분석 설명 또는 게시물 ID"
        value={search}
        onChange={(event) => {
          const next = new URLSearchParams(params);
          if (event.currentTarget.value)
            next.set("search", event.currentTarget.value);
          else next.delete("search");
          setParams(next, { replace: true });
        }}
        maxLength={200}
        leftSection={<MagnifyingGlass size={15} aria-hidden />}
      />
      <Select
        className={classes.kindFilter}
        label="종류"
        value={assetType}
        allowDeselect={false}
        data={[
          { value: "", label: "모든 종류" },
          { value: "image", label: "사진" },
          { value: "video_thumbnail", label: "영상 썸네일" },
        ]}
        onChange={(value) => filter({ type: value ?? "" })}
      />
      <Select
        className={classes.statusFilter}
        label="분석 상태"
        value={analysisStatus}
        allowDeselect={false}
        data={[
          { value: "", label: "모든 분석 상태" },
          { value: "ready", label: "분석 있음" },
          { value: "missing", label: "미분석" },
        ]}
        onChange={(value) => filter({ analysis: value ?? "" })}
      />
    </div>
  );
  return (
    <div className={classes.library}>
      <DataPage
        title="SNS 레퍼런스"
        isPending={false}
        actions={
          <Button
            leftSection={<UploadSimple size={17} aria-hidden />}
            onClick={() => setUploading(true)}
          >
            미디어 업로드
          </Button>
        }
      >
        <nav className={classes.tabs} aria-label="레퍼런스 관리">
          <Button
            className={classes.tab}
            data-active={view === "media" || undefined}
            variant="subtle"
            color="ink"
            onClick={() => filter({ view: "" })}
          >
            미디어 라이브러리
          </Button>
          <Button
            className={classes.tab}
            data-active={view === "accounts" || undefined}
            variant="subtle"
            color="ink"
            onClick={() => filter({ view: "accounts" })}
          >
            계정 · 캐릭터 연결
          </Button>
        </nav>
        {view === "media" ? (
          <>
            {filters}
            <Group justify="space-between" gap="xs" wrap="nowrap">
              <Text fw={700}>
                {accountValue?.label ||
                  (characterId ? "캐릭터의 레퍼런스" : "전체 미디어")}
              </Text>
              <Group gap="xs" wrap="nowrap">
                <Text
                  size="xs"
                  c="ink.6"
                  className={classes.count}
                  role="status"
                >
                  {media.items.length}개 표시 · 최근 등록순
                </Text>
                <Button
                  variant="subtle"
                  color="ink"
                  size="compact-sm"
                  loading={media.isFetching}
                  onClick={refresh}
                  aria-label="목록과 이미지 새로고침"
                >
                  <ArrowClockwise size={17} aria-hidden />
                </Button>
              </Group>
            </Group>
            {media.error ? (
              <Alert color="red" title="미디어를 불러오지 못했습니다">
                {media.error.message}
                <Button
                  variant="subtle"
                  color="red"
                  onClick={() => void media.refetch()}
                >
                  다시 시도
                </Button>
              </Alert>
            ) : null}
            {media.isPending ? (
              <Stack gap="xs" aria-label="미디어 불러오는 중">
                {Array.from({ length: 4 }, (_, i) => (
                  <Skeleton key={i} h={85} />
                ))}
              </Stack>
            ) : null}
            {!media.isPending && !media.error && !media.items.length ? (
              <Paper p="xl" ta="center">
                <Stack align="center">
                  <ImageSquare size={30} aria-hidden />
                  <Text fw={650}>표시할 미디어가 없습니다.</Text>
                  <Text size="sm" c="ink.6">
                    필터를 변경하거나 이미지를 직접 등록해 보세요.
                  </Text>
                  <Button variant="default" onClick={() => setUploading(true)}>
                    미디어 업로드
                  </Button>
                </Stack>
              </Paper>
            ) : null}
            {media.items.length ? (
              <Table
                className={classes.mediaTable}
                aria-label="레퍼런스 미디어 목록"
                verticalSpacing="sm"
                horizontalSpacing="sm"
              >
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>미리보기</Table.Th>
                    <Table.Th>계정</Table.Th>
                    <Table.Th>미디어 · 분석 요약</Table.Th>
                    <Table.Th>종류</Table.Th>
                    <Table.Th>분석 상태</Table.Th>
                    <Table.Th aria-label="상세" />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {media.items.map((item) => (
                    <Table.Tr key={item.id}>
                      <Table.Td>
                        <UnstyledButton
                          className={classes.thumbnail}
                          onClick={() => setSelected(item)}
                          aria-label={`${item.postId} ${item.slideIndex}번 이미지 상세 보기`}
                        >
                          <Image
                            src={previewUrl(item.imageUrl)}
                            alt={
                              item.analysis?.content.description ||
                              `${assetLabel(item)} 미리보기`
                            }
                            loading="lazy"
                            fallbackSrc={undefined}
                            fit="cover"
                          />
                        </UnstyledButton>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" truncate>
                          @{item.influencer?.username || "계정"}
                        </Text>
                        <Text size="xs" c="ink.6">
                          Instagram
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <UnstyledButton
                          className={classes.mediaTitle}
                          onClick={() => setSelected(item)}
                        >
                          {item.analysis?.content.description ||
                            `${item.postId} · ${item.slideIndex}번 미디어`}
                        </UnstyledButton>
                        <Text size="xs" c="ink.6" truncate>
                          {item.analysis
                            ? [
                                item.analysis.content.framing,
                                item.analysis.content.pose,
                              ]
                                .filter(Boolean)
                                .join(" · ") || "분석 상세 보기"
                            : "분석 내용이 아직 없습니다"}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <span className={classes.asset}>
                          {item.assetType === "image" ? (
                            <ImageSquare size={14} aria-hidden />
                          ) : (
                            <VideoCamera size={14} aria-hidden />
                          )}
                          {assetLabel(item)}
                        </span>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" c={item.analysis ? "teal.9" : "ink.6"}>
                          {item.analysis ? "분석 있음" : "미분석"}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Button
                          variant="subtle"
                          color="ink"
                          size="compact-sm"
                          onClick={() => setSelected(item)}
                          aria-label={`${item.postId} ${item.slideIndex}번 분석 상세`}
                        >
                          <CaretRight size={16} aria-hidden />
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            ) : null}
            <LoadMore
              hasNextPage={Boolean(media.hasNextPage)}
              isFetching={media.isFetching}
              onLoadMore={() => void media.fetchNextPage()}
            />
          </>
        ) : (
          <>
            <Group justify="space-between">
              <TextInput
                label="SNS 계정 검색"
                placeholder="사용자 이름"
                value={accountSearch}
                onChange={(event) =>
                  setAccountSearch(event.currentTarget.value)
                }
                leftSection={<MagnifyingGlass size={16} aria-hidden />}
              />
              <Group>
                <Button
                  variant="default"
                  component={Link}
                  to="/sns-references/connections"
                >
                  캐릭터 연결 관리
                </Button>
                <Button
                  leftSection={<Plus size={16} aria-hidden />}
                  onClick={() => setAddingAccount(true)}
                >
                  계정 추가
                </Button>
              </Group>
            </Group>
            {accounts.error ? (
              <Alert color="red">
                {accounts.error.message}
                <Button onClick={() => void accounts.refetch()}>
                  다시 시도
                </Button>
              </Alert>
            ) : null}
            {accounts.isPending ? (
              <Skeleton h={180} />
            ) : (
              <Table.ScrollContainer minWidth={340}>
                <Table aria-label="SNS 계정 목록">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>계정</Table.Th>
                      <Table.Th>플랫폼</Table.Th>
                      <Table.Th>관리</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {accounts.items.map((account) => (
                      <Table.Tr key={account.id}>
                        <Table.Td>
                          <Text fw={600}>@{account.username}</Text>
                          <Anchor
                            href={previewUrl(account.url) || undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            size="xs"
                          >
                            계정 원본 <ArrowSquareOut size={12} aria-hidden />
                          </Anchor>
                        </Table.Td>
                        <Table.Td>
                          <Badge variant="light" color="ink">
                            Instagram
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Button
                            variant="default"
                            size="xs"
                            onClick={() =>
                              filter({
                                view: "",
                                account: account.id,
                                accountName: `@${account.username}`,
                              })
                            }
                          >
                            미디어 보기
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
                {!accounts.items.length ? (
                  <Text c="ink.6" py="xl" ta="center">
                    등록된 계정이 없거나 검색 결과가 없습니다.
                  </Text>
                ) : null}
              </Table.ScrollContainer>
            )}
            <LoadMore
              hasNextPage={Boolean(accounts.hasNextPage)}
              isFetching={accounts.isFetching}
              onLoadMore={() => void accounts.fetchNextPage()}
            />
          </>
        )}
      </DataPage>
      {selected ? (
        <MediaDetailModal
          item={media.items.find((item) => item.id === selected.id) ?? selected}
          items={media.items}
          onSelect={setSelected}
          onClose={() => setSelected(null)}
          onRefresh={refresh}
        />
      ) : null}
      {uploading ? (
        <MediaUploadModal
          initialAccount={accountValue}
          onClose={() => setUploading(false)}
          onRegistered={registered}
        />
      ) : null}
      {addingAccount ? (
        <AccountModal
          onClose={() => setAddingAccount(false)}
          onAdded={(account: Influencer) => {
            setAddingAccount(false);
            filter({
              account: account.id,
              accountName: `@${account.username}`,
            });
          }}
        />
      ) : null}
    </div>
  );
}
