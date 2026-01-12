using System;

namespace FodraszatWeblap.Models
{
    /// <summary>
    /// Egy időpontfoglalás adatmodelljét reprezentálja.
    /// </summary>
    public class BookingModel
    {
        /// <summary>
        /// A foglaló teljes neve.
        /// </summary>
        public string Name { get; set; }

        /// <summary>
        /// A foglaló email címe.
        /// </summary>
        public string Email { get; set; }

        /// <summary>
        /// A lefoglalt szolgáltatás típusa (pl. "Férfi hajvágás").
        /// </summary>
        public string ServiceType { get; set; }

        /// <summary>
        /// A foglalás pontos dátuma és ideje.
        /// </summary>
        public DateTime BookingDate { get; set; }

        public BookingModel(string name, string email, string serviceType, DateTime bookingDate)
        {
            Name = name;
            Email = email;
            ServiceType = serviceType;
            BookingDate = bookingDate;
        }
    }
}
