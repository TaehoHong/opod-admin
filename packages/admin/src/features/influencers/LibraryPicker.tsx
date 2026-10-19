import {
  Button,
  Combobox,
  Input,
  InputBase,
  Loader,
  Text,
  useCombobox,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { CursorPage } from "../../shared/api/useCursorList";

export type PickerOption = { value: string; label: string };

// Server search + cursor paging. Unlike the existing fixed-size CharacterSelect,
// this selector must reach records beyond the first 100 characters/accounts.
export function LibraryPicker({
  label,
  value,
  onChange,
  queryKey,
  fetchOptions,
  disabled,
  placeholder,
  error,
}: {
  label: string;
  value: PickerOption | null;
  onChange: (value: PickerOption | null) => void;
  queryKey: readonly unknown[];
  fetchOptions: (
    search: string,
    cursor?: string,
  ) => Promise<CursorPage<PickerOption>>;
  disabled?: boolean;
  placeholder?: string;
  error?: string;
}) {
  const [search, setSearch] = useState("");
  const [debounced] = useDebouncedValue(search, 250);
  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption();
      setSearch("");
    },
    onDropdownOpen: () => combobox.focusSearchInput(),
  });
  const query = useInfiniteQuery({
    queryKey: [...queryKey, debounced],
    queryFn: ({ pageParam }) => fetchOptions(debounced, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: combobox.dropdownOpened,
  });
  const options = query.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Combobox
      store={combobox}
      withinPortal
      onOptionSubmit={(id) => {
        onChange(options.find((item) => item.value === id) ?? null);
        combobox.closeDropdown();
      }}
    >
      <Combobox.Target>
        <InputBase
          component="button"
          type="button"
          pointer
          label={label}
          error={error}
          disabled={disabled}
          onClick={() => combobox.toggleDropdown()}
          rightSection={<Combobox.Chevron />}
          rightSectionPointerEvents="none"
        >
          <Text component="span" truncate>
            {value?.label ?? (
              <Input.Placeholder>
                {placeholder ?? `전체 ${label}`}
              </Input.Placeholder>
            )}
          </Text>
        </InputBase>
      </Combobox.Target>
      <Combobox.Dropdown>
        <Combobox.Search
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            combobox.resetSelectedOption();
          }}
          placeholder={`${label} 검색`}
          aria-label={`${label} 검색`}
          maxLength={100}
        />
        <Combobox.Options mah={240} style={{ overflowY: "auto" }}>
          <Combobox.Option value="">
            {placeholder ?? `전체 ${label}`}
          </Combobox.Option>
          {options.map((option) => (
            <Combobox.Option
              key={option.value}
              value={option.value}
              active={option.value === value?.value}
            >
              {option.label}
            </Combobox.Option>
          ))}
          {query.isPending ? (
            <Combobox.Empty>
              <Loader size="xs" aria-label="목록 불러오는 중" />
            </Combobox.Empty>
          ) : null}
          {!query.isPending && !query.error && !options.length ? (
            <Combobox.Empty>검색 결과가 없습니다.</Combobox.Empty>
          ) : null}
        </Combobox.Options>
        {query.error ? (
          <Combobox.Footer>
            <Text size="sm" c="red">
              목록을 불러오지 못했습니다.
            </Text>
            <Button variant="subtle" onClick={() => void query.refetch()}>
              다시 시도
            </Button>
          </Combobox.Footer>
        ) : null}
        {query.hasNextPage ? (
          <Combobox.Footer>
            <Button
              fullWidth
              variant="subtle"
              size="xs"
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              더 불러오기
            </Button>
          </Combobox.Footer>
        ) : null}
      </Combobox.Dropdown>
    </Combobox>
  );
}
