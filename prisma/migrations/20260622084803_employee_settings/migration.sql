-- AlterTable
ALTER TABLE "User" ADD COLUMN     "maxClients" INTEGER,
ADD COLUMN     "staffNotes" TEXT;

-- CreateTable
CREATE TABLE "_AllowedSellers" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_AllowedSellers_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_AllowedSellers_B_index" ON "_AllowedSellers"("B");

-- AddForeignKey
ALTER TABLE "_AllowedSellers" ADD CONSTRAINT "_AllowedSellers_A_fkey" FOREIGN KEY ("A") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_AllowedSellers" ADD CONSTRAINT "_AllowedSellers_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
