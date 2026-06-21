import { getBookings } from "@/lib/data/bookings";
import { BookingsList } from "@/components/bookings/bookings-list";

export const dynamic = "force-dynamic";

export default async function BookingsPage() {
  const data = await getBookings();
  return <BookingsList data={data} />;
}
