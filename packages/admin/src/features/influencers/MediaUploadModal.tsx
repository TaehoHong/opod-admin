import {
  Alert,
  Badge,
  Button,
  FileButton,
  Group,
  Image,
  Modal,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { UploadSimple, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useBeforeUnload } from "react-router-dom";
import { ApiError } from "../../shared/api/apiClient";
import { uploadInfluencerMedia, type InfluencerMedia } from "./api";
import { LibraryPicker, type PickerOption } from "./LibraryPicker";
import { accountOptions } from "./library-options";
import classes from "./ReferenceLibrary.module.css";

type UploadFile = {
  id: string;
  file: File;
  preview: string;
  type: InfluencerMedia["assetType"];
  status: "pending" | "uploading" | "saved" | "failed";
  message?: string;
};
export function MediaUploadModal({
  initialAccount,
  onClose,
  onRegistered,
}: {
  initialAccount: PickerOption | null;
  onClose: () => void;
  onRegistered: () => void;
}) {
  const [account, setAccount] = useState(initialAccount);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const previews = useRef(new Set<string>());
  const form = useForm({
    mode: "uncontrolled",
    initialValues: { postUrl: "", startIndex: 1 as number | string },
    validate: {
      postUrl: (value) => {
        try {
          const url = new URL(value.trim());
          return url.protocol === "https:" &&
            ["www.instagram.com", "instagram.com"].includes(url.hostname) &&
            /^\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)
            ? null
            : "Instagram 게시물 또는 릴스 링크를 입력해 주세요.";
        } catch {
          return "Instagram 게시물 또는 릴스 링크를 입력해 주세요.";
        }
      },
      startIndex: (value) =>
        Number.isInteger(Number(value)) &&
        Number(value) >= 1 &&
        Number(value) + files.length - 1 <= 100
          ? null
          : "슬라이드 번호는 1~100 범위여야 합니다.",
    },
  });
  useEffect(() => {
    const urls = previews.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);
  useBeforeUnload((event) => {
    if (busy || files.some((file) => file.status !== "saved"))
      event.preventDefault();
  });
  const close = () => {
    if (busy) return;
    if (
      files.some((file) => file.status !== "saved") &&
      !window.confirm(
        "아직 등록하지 못한 파일이 있습니다. 업로드 창을 닫을까요?",
      )
    )
      return;
    onClose();
  };
  const addFiles = (chosen: File[]) => {
    if (locked) return;
    if (chosen.length + files.length > 20) {
      setError("한 번에 최대 20개를 선택할 수 있습니다.");
      return;
    }
    if (
      chosen.some(
        (file) =>
          !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
          file.size > 30 * 1024 * 1024 ||
          !file.size,
      )
    ) {
      setError(
        "비어 있지 않은 JPG·PNG·WebP 이미지 파일을 선택해 주세요. 파일당 최대 30MB이며, 영상은 썸네일 이미지로 올려야 합니다.",
      );
      return;
    }
    setError(null);
    setFiles((current) => [
      ...current,
      ...chosen.map((file) => {
        const preview = URL.createObjectURL(file);
        previews.current.add(preview);
        return {
          id: crypto.randomUUID(),
          file,
          preview,
          type: "image" as const,
          status: "pending" as const,
        };
      }),
    ]);
  };
  const update = (id: string, changes: Partial<UploadFile>) =>
    setFiles((current) =>
      current.map((file) => (file.id === id ? { ...file, ...changes } : file)),
    );
  const submit = async (values: typeof form.values) => {
    if (!account || !files.length) {
      setError(
        !account
          ? "저장할 SNS 계정을 선택해 주세요."
          : "등록할 이미지 파일을 선택해 주세요.",
      );
      return;
    }
    setError(null);
    setBusy(true);
    setLocked(true);
    const url = new URL(values.postUrl.trim());
    const postId = url.pathname.split("/")[2];
    try {
      for (const [index, item] of files.entries()) {
        if (item.status === "saved") continue;
        update(item.id, { status: "uploading", message: undefined });
        try {
          const result = await uploadInfluencerMedia(item.file, {
            influencerId: account.value,
            postId,
            postUrl: `${url.origin}${url.pathname}`,
            slideIndex: Number(values.startIndex) + index,
            assetType: item.type,
          });
          update(item.id, {
            status: "saved",
            message: result.created ? "등록 완료" : "이미 등록된 동일 파일",
          });
        } catch (cause) {
          update(item.id, {
            status: "failed",
            message:
              cause instanceof ApiError && cause.status === 409
                ? "같은 슬라이드 번호에 다른 이미지가 있습니다. 원본 게시물과 번호를 확인해 주세요."
                : cause instanceof Error
                  ? cause.message
                  : "업로드하지 못했습니다. 다시 시도해 주세요.",
          });
        }
      }
    } finally {
      setBusy(false);
      onRegistered();
    }
  };
  const savedCount = files.filter((file) => file.status === "saved").length;
  const complete = files.length > 0 && savedCount === files.length;
  return (
    <Modal
      opened
      onClose={close}
      title="미디어 업로드"
      size="lg"
      closeOnClickOutside={false}
      closeOnEscape={!busy}
      withCloseButton={!busy}
    >
      <form onSubmit={form.onSubmit((values) => void submit(values))}>
        <Stack gap="lg">
          <Text size="sm" c="ink.6">
            한 게시물의 사진과 영상 썸네일을 함께 등록합니다. 분석 없이 올린
            파일은 미분석으로 저장됩니다.
          </Text>
          <div className={classes.uploadFields}>
            <LibraryPicker
              label="저장할 SNS 계정"
              placeholder="계정 선택"
              value={account}
              onChange={setAccount}
              fetchOptions={accountOptions}
              queryKey={["library-account-options"]}
              disabled={locked}
            />
            <TextInput
              required
              label="원본 게시물 링크"
              placeholder="https://www.instagram.com/p/.../"
              disabled={locked}
              maxLength={2048}
              key={form.key("postUrl")}
              {...form.getInputProps("postUrl")}
            />
            <NumberInput
              label="시작 슬라이드 번호"
              min={1}
              max={100}
              allowDecimal={false}
              disabled={locked}
              key={form.key("startIndex")}
              {...form.getInputProps("startIndex")}
            />
          </div>
          {!locked ? (
            <div
              className={classes.dropzone}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                addFiles(Array.from(event.dataTransfer.files));
              }}
            >
              <UploadSimple size={28} aria-hidden />
              <Text fw={600}>이미지를 끌어 놓거나 파일을 선택하세요</Text>
              <Text size="sm" c="ink.6">
                JPG · PNG · WebP / 파일당 최대 30MB / 최대 20개
              </Text>
              <FileButton
                multiple
                accept="image/jpeg,image/png,image/webp"
                onChange={addFiles}
              >
                {(props) => (
                  <Button {...props} variant="default">
                    파일 선택
                  </Button>
                )}
              </FileButton>
            </div>
          ) : null}
          {error ? (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          ) : null}
          <Stack gap="sm">
            {files.map((item, index) => (
              <div key={item.id} className={classes.uploadItem}>
                <Image
                  src={item.preview}
                  alt={`${item.file.name} 업로드 미리보기`}
                  w={54}
                  h={68}
                  fit="cover"
                  radius="sm"
                />
                <div className={classes.fileDescription}>
                  <Text size="sm" fw={600} className={classes.wrap}>
                    {item.file.name}
                  </Text>
                  <Text size="xs" c="ink.6">
                    선택 순서 {index + 1} ·{" "}
                    {(item.file.size / 1024 / 1024).toFixed(1)}MB
                  </Text>
                  {item.message ? (
                    <Text
                      size="xs"
                      c={item.status === "failed" ? "red" : "teal.9"}
                      role={item.status === "failed" ? "alert" : undefined}
                    >
                      {item.message}
                    </Text>
                  ) : null}
                </div>
                {!locked ? (
                  <Select
                    aria-label={`${item.file.name} 종류`}
                    value={item.type}
                    onChange={(value) =>
                      update(item.id, { type: value as UploadFile["type"] })
                    }
                    allowDeselect={false}
                    data={[
                      { value: "image", label: "사진" },
                      { value: "video_thumbnail", label: "영상 썸네일" },
                    ]}
                    w={130}
                  />
                ) : (
                  <Badge
                    color={
                      item.status === "saved"
                        ? "teal"
                        : item.status === "failed"
                          ? "red"
                          : "gray"
                    }
                  >
                    {item.status === "uploading"
                      ? "등록 중"
                      : item.status === "saved"
                        ? "완료"
                        : item.status === "failed"
                          ? "실패"
                          : "대기"}
                  </Badge>
                )}
                {!locked ? (
                  <Button
                    variant="subtle"
                    color="ink"
                    size="compact-sm"
                    aria-label={`${item.file.name} 제거`}
                    onClick={() => {
                      URL.revokeObjectURL(item.preview);
                      previews.current.delete(item.preview);
                      setFiles((current) =>
                        current.filter((file) => file.id !== item.id),
                      );
                    }}
                  >
                    <X size={16} aria-hidden />
                  </Button>
                ) : null}
              </div>
            ))}
          </Stack>
          {locked ? (
            <Text size="sm" role="status">
              {savedCount} / {files.length}개 등록 완료
              {busy
                ? " · 등록 중입니다. 창을 닫지 마세요."
                : complete
                  ? ""
                  : " · 실패한 파일만 재시도합니다."}
            </Text>
          ) : null}
          <Group justify="flex-end">
            <Button variant="default" onClick={close} disabled={busy}>
              {complete ? "닫기" : "취소"}
            </Button>
            {!complete ? (
              <Button type="submit" loading={busy} disabled={!files.length}>
                {locked ? "실패 파일 재시도" : `${files.length}개 등록`}
              </Button>
            ) : null}
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
