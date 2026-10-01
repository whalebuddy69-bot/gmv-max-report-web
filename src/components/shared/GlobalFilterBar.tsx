import { useMemo } from "react";
import { X } from "lucide-react";
import type { ShopContentType } from "@/types/report";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker } from "./DateRangePicker";
import { SelectFilter, type FilterOption } from "./SelectFilter";
import { StorePicker } from "./StorePicker";
import { useCampaignOptions, useCreatorOptions, useCreators, useProducts } from "@/hooks/useGmvReportData";
import { countActiveFilters, toRangeQuery, useFilterStore } from "@/store/filterStore";
import { formatCompact } from "@/lib/format";

/** The filter bar above both modes */
export function GlobalFilterBar() {
  const filters = useFilterStore();
  const range = toRangeQuery(filters);

  // Options are listed for the store and date range only
  const optionScope = { storeIds: range.storeIds, from: range.from, to: range.to };

  // Product, creator and creative type all describe things only Product campaigns have
  const productScope = filters.promotionType === "PRODUCT";

  // The campaign list is the one dropdown that differs per GMV Max product.
  const campaignQuery = useCampaignOptions({ ...optionScope, promotionType: filters.promotionType });
  // The other kind of creator: a Live campaign's identity, which is often not the shop's own
  // channel
  const identityQuery = useCreatorOptions(optionScope, { enabled: !productScope });
  const productQuery = useProducts(optionScope, { enabled: productScope });
  const creatorQuery = useCreators(optionScope, { enabled: productScope });

  const campaignOptions = useMemo<FilterOption[]>(
    () =>
      (campaignQuery.data ?? []).map((campaign) => ({
        value: campaign.campaignId,
        label: campaign.campaignName ?? campaign.campaignId,
        hint: formatCompact(campaign.cost, "currency"),
      })),
    [campaignQuery.data],
  );

  const productOptions = useMemo<FilterOption[]>(
    () =>
      (productQuery.data ?? []).map((product) => ({
        value: product.itemGroupId,
        label: product.productName ?? product.itemGroupId,
        hint: formatCompact(product.cost, "currency"),
      })),
    [productQuery.data],
  );

  const identityOptions = useMemo<FilterOption[]>(
    () =>
      (identityQuery.data ?? []).map((creator) => ({
        value: creator.identityId,
        // The id is the only thing guaranteed to be there, and it is what gets sent.
        label: creator.ttAccountName ?? creator.identityId,
        hint: formatCompact(creator.cost, "currency"),
      })),
    [identityQuery.data],
  );

  const creatorOptions = useMemo<FilterOption[]>(
    () =>
      (creatorQuery.data ?? []).map((creator) => ({
        value: creator.ttAccountName,
        label: creator.ttAccountName,
        hint: formatCompact(creator.cost, "currency"),
      })),
    [creatorQuery.data],
  );

  const activeCount = countActiveFilters(filters);

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-2.5">
      <StorePicker />

      <DateRangePicker
        dateFrom={filters.dateFrom}
        dateTo={filters.dateTo}
        onChange={filters.setDateRange}
      />

      <SelectFilter
        label="แคมเปญ"
        options={campaignOptions}
        value={filters.campaignId}
        onChange={filters.setCampaignId}
        isLoading={campaignQuery.isLoading}
      />

      {productScope ? null : (
        <SelectFilter
          label="Creator"
          options={identityOptions}
          value={filters.identityId}
          onChange={filters.setIdentityId}
          isLoading={identityQuery.isLoading}
          emptyHint="ไม่มีแคมเปญ Live ที่ระบุ creator ในช่วงนี้"
        />
      )}

      {productScope ? (
        <>
          <SelectFilter
            label="สินค้า"
            options={productOptions}
            value={filters.itemGroupId}
            onChange={filters.setItemGroupId}
            isLoading={productQuery.isLoading}
          />

          <SelectFilter
            label="Creator"
            options={creatorOptions}
            value={filters.accountName}
            onChange={filters.setAccountName}
            isLoading={creatorQuery.isLoading}
            emptyHint="ไม่มี creator ในช่วงนี้ - TikTok เติมชื่อให้เฉพาะโพสต์ของร้านเอง"
          />

          <Select
            value={filters.contentType}
            onValueChange={(value) => filters.setContentType(value as ShopContentType | "ALL")}
          >
            <SelectTrigger className="h-8 w-36 text-sm">
              <SelectValue placeholder="ประเภทชิ้นงาน" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">ทุกประเภท</SelectItem>
              <SelectItem value="VIDEO">วิดีโอ</SelectItem>
              <SelectItem value="PRODUCT_CARD">การ์ดสินค้า</SelectItem>
            </SelectContent>
          </Select>
        </>
      ) : null}

      {activeCount > 0 ? (
        <Button variant="ghost" size="sm" onClick={filters.clearFilters}>
          <X className="h-3.5 w-3.5" aria-hidden />
          ล้างตัวกรอง ({activeCount})
        </Button>
      ) : null}
    </div>
  );
}
